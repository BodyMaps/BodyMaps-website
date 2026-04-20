import { useEffect, useState } from "react";
import { centerOnCursor, setZoom, zoomToFit } from "../helpers/CornerstoneNifti2";
type Props = {
	submitted: number;
	setSubmitted: React.Dispatch<React.SetStateAction<number>>;
	setZoomMode: React.Dispatch<React.SetStateAction<boolean>>;
};
const ZoomHandle = ({ submitted, setSubmitted, setZoomMode: _setZoomMode }: Props) => {
	const [_text, setText] = useState(submitted.toString());
	// const [submitted, setSubmitted] = useState(1);
	useEffect(() => {
		setZoom(submitted);
		setText(submitted.toFixed(2));
	}, [submitted]);

	// const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
	// 	if (e.key === "Enter") {
	// 		const num = Math.min(Math.max(Number(text), 0.5), 2);

	// 		if (!isNaN(num)) {
	// 			setSubmitted(num);
	// 			setText(num.toFixed(2)); // clear input if you want
	// 		} else {
	// 			setText(submitted.toFixed(2));
	// 		}
	// 	}
	// };
	return (
		<div className="windowing-slider w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
		<div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">Zoom Settings</div>
		<div className="pb-2 pl-4 pr-4 flex flex-col gap-2">

			<div className="flex flex-col gap-1 justify-between w-full">
				<div className="flex justify-between w-full items-center">

					<div style={{ color: 'white' }}>Zoom</div>
				</div>
				<input
				type="range"
				min="0.5"
				max="2"
				step="0.11"
				className="w-full"
				value={submitted}
				onChange={(e) => setSubmitted(Number(e.target.value))}
				/>

				<div className="flex gap-1 w-2/3 justify-end">
				{/* <input
					type="text"
					aria-label="s"
					value={text}	
					onChange={(e) => setText(e.target.value.replace(/[^0-9.-]/g, ""))} // allow only digits, minus, dot
					onKeyDown={handleKeyDown}
					className="border text-white p-1 rounded-md w-1/3"
					/> */}
			</div>
			</div>
			<div className="grid grid-cols-2 gap-1 w-full">

			<button className="text-white !bg-gray-700 !font-medium text-nowrap !text-xs !p-1" onClick={() => {
				centerOnCursor();
			}}>
				Center Cursor
			</button>
			<button className="text-white  !bg-gray-700 !font-medium text-nowrap !text-xs !p-1" onClick={() => {
				zoomToFit();
				setText("1.0");
			}}>
				Reset
			</button>

			</div>

		</div>
		</div>
	);
};

export default ZoomHandle;
