/** Run from the browser console: (await import('/tests/browser/anatomy-audit.ts')).auditAnatomy() */
const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))));
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const api = () => (window as any).anatomyTest;
const setValue = (selector: string, value: string) => {
  const element = document.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
  check(element, `Missing control: ${selector}`);
  const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
const planes = () => {
  const found: any[] = [];
  api().mesh()?.scene.traverse((object: any) => {
    if (object.isMesh && object.geometry?.getAttribute('position')?.count === 4 && object.material?.map?.isCanvasTexture) found.push(object);
  });
  return found;
};
const textureHash = (plane: any) => {
  const canvas = plane.material.map.image as HTMLCanvasElement;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 13) hash = Math.imul(hash ^ pixels[i], 16777619);
  return hash >>> 0;
};
const dispatchAtWorld = (point: number[], double = false) => {
  const { camera, gl } = api().mesh();
  const p = camera.position.clone().set(...point).project(camera);
  const rect = gl.domElement.getBoundingClientRect();
  const x = (p.x + 1) * rect.width / 2, y = (1 - p.y) * rect.height / 2;
  for (const type of ['pointerdown', 'pointerup', 'click', ...(double ? ['dblclick'] : [])]) {
    const event = new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, detail: double ? 2 : 1 });
    // Synthetic browser events don't calculate target-relative offsets.
    Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: y }, pointerId: { value: 1 } });
    gl.domElement.dispatchEvent(event);
  }
};
export async function auditAnatomy() {
  const results: Record<string, unknown> = {};
  const axial = api().engine.getViewport('CT_NIFTI_AXIAL');
  setValue('select', 'off'); await pause();
  check(planes().length === 0, 'Hidden planes remain rendered');
  dispatchAtWorld([0, 0, 0]); await pause();
  check(document.querySelector('.anatomy-focus'), 'Organ raycast did not select');
  results.organFocus = document.querySelector('.anatomy-focus')!.textContent;
  (document.querySelector('.anatomy-focus button') as HTMLButtonElement).click(); await pause();
  check(!document.querySelector('.anatomy-focus'), 'Clear focus did not clear');
  setValue('select', 'axial'); await pause();
  check(planes().length === 1, 'Axial mode needs one plane');
  const before = textureHash(planes()[0]);
  const position = Array.from(planes()[0].geometry.getAttribute('position').array) as number[];
  (document.querySelector('[aria-label="Next anatomy slice"]') as HTMLButtonElement).click(); await pause();
  check(textureHash(planes()[0]) !== before, 'Slice scrolling left a stale CT texture');
  const after = Array.from(planes()[0].geometry.getAttribute('position').array) as number[];
  check(after.some((v, i) => Math.abs(v - position[i]) > .01), 'Slice plane did not move physically');
  results.sliceScrollChangesPixelsAndGeometry = true;
  const oldHash = textureHash(planes()[0]);
  const oldProps = axial.getProperties();
  axial.setProperties({ voiRange: { lower: -150, upper: 250 } }); axial.render(); await pause();
  check(textureHash(planes()[0]) !== oldHash, 'Window/level left a stale CT texture');
  results.windowLevelUpdatesTexture = true;
  axial.setProperties(oldProps); axial.render(); await pause();
  setValue('select', 'oblique'); await pause();
  const pivot = axial.getCamera().focalPoint.slice();
  setValue('[aria-label="Oblique tilt around left-right axis"]', '30'); await pause();
  setValue('[aria-label="Oblique tilt around anterior-posterior axis"]', '-20'); await pause();
  const camera = axial.getCamera();
  check(camera.focalPoint.every((v: number, i: number) => Math.abs(v - pivot[i]) < .001), 'Oblique rotation displaced the selected anatomy');
  check(Math.abs(camera.viewPlaneNormal[1] - .5) < 1e-8, 'Tilt control did not change the actual camera');
  const plane = planes()[0];
  const corners = Array.from(plane.geometry.getAttribute('position').array) as number[];
  const canvas = axial.getCanvas();
  const canvasCorners = [[0, 0], [canvas.clientWidth, 0], [canvas.clientWidth, canvas.clientHeight], [0, canvas.clientHeight]];
  // Independent inverse mapping: world LPS = [-three.x + centerL, three.z + centerP, three.y + centerS].
  const center = api().center;
  let maximumError = 0;
  canvasCorners.forEach((p, i) => {
    const expected = axial.canvasToWorld(p);
    const actual = [-corners[i * 3] + center[0], corners[i * 3 + 2] + center[1], corners[i * 3 + 1] + center[2]];
    expected.forEach((v: number, j: number) => { maximumError = Math.max(maximumError, Math.abs(v - actual[j])); });
  });
  check(maximumError < .001, 'CT texture corners are not physically registered');
  results.obliqueCornerErrorMm = maximumError;
  results.obliquePivot = camera.focalPoint;
  // Pick a plane point away from the selected organ. Let the renderer perform the raycast.
  const pick = [0, 1, 2].map(j => .7 * corners[j] + .2 * corners[3 + j] + .1 * corners[9 + j]);
  dispatchAtWorld(pick, true); await pause();
  const expected = [-pick[0] + center[0], pick[2] + center[1], pick[1] + center[2]];
  const output = document.querySelector('output')!.textContent!.split(',').map(Number);
  check(output.every((v, i) => Math.abs(v - expected[i]) < .06), `Plane picking did not move crosshair: ${output} vs ${expected}`);
  results.planePickingErrorMm = Math.max(...output.map((v, i) => Math.abs(v - expected[i])));
  api().jump(center); await pause();
  (Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Reset anatomy view')!).click(); await pause();
  check(Math.abs(axial.getCamera().viewPlaneNormal[2] + 1) < 1e-8, 'Reset left the camera oblique');
  setValue('select', 'all'); await pause();
  for (let tries = 0; planes().length !== 3 && tries < 30; tries++) await pause();
  check(planes().length === 3, 'All three mode did not render three CT planes');
  results.allThreePlanes = true;
  for (const mode of ['coronal', 'sagittal']) {
    setValue('select', mode); await pause();
    check(planes().length === 1, mode + ' mode needs one plane');
    const selected = api().engine.getViewport('CT_NIFTI_' + mode.toUpperCase());
    const prior = selected.getSliceIndex();
    (document.querySelector('[aria-label="Next anatomy slice"]') as HTMLButtonElement).click(); await pause();
    check(selected.getSliceIndex() === prior + 1, mode + ' control scrolled the wrong viewport');
  }
  results.coronalAndSagittalScroll = true;
  setValue('select', 'all'); await pause();
  const screenshot = api().captureMeshCanvas();
  check(screenshot?.startsWith('data:image/png;base64,') && screenshot.length > 20000, 'Production screenshot helper did not capture the new scene');
  results.screenshotBytesApprox = Math.round(screenshot.length * .75);
  results.volumeId = axial.getVolumeId();
  return results;
}
