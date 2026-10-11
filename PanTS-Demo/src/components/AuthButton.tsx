import { IconChevronDown, IconLogout, IconPlayerPlay, IconSettings, IconUser } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import styles from "./AuthButton.module.css";

type Props = { variant?: "default" | "sidebar"; collapsed?: boolean; onWalkthrough?: () => void };

export default function AuthButton({ variant = "default", collapsed = false, onWalkthrough }: Props) {
    const { user, isAuthenticated, loading, signOut, promptAuth } = useAuth();
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState("");
    const [position, setPosition] = useState({ left: 12, bottom: 80 });
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const sidebar = variant === "sidebar";
    const closeMenu = (restore = false) => { setMenuOpen(false); if (restore) triggerRef.current?.focus(); };

    useEffect(() => {
        if (!menuOpen) return;
        menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
        const outside = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        const key = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); triggerRef.current?.focus(); }
        };
        const resize = () => setMenuOpen(false);
        document.addEventListener("mousedown", outside);
        document.addEventListener("keydown", key);
        window.addEventListener("resize", resize);
        return () => {
            document.removeEventListener("mousedown", outside);
            document.removeEventListener("keydown", key);
            window.removeEventListener("resize", resize);
        };
    }, [menuOpen]);

    if (loading) return null;
    if (!isAuthenticated || !user) return (
        <button type="button" className={`${styles.signInBtn} ${sidebar ? styles.sidebarSignIn : ""}`} onClick={() => promptAuth()} title={collapsed ? "Sign in" : undefined} aria-label="Sign in">
            {sidebar && <IconUser size={19} aria-hidden="true" />}
            {(!sidebar || !collapsed) && <span>Sign in</span>}
        </button>
    );

    const toggle = () => {
        if (!menuOpen && sidebar && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const width = Math.min(280, window.innerWidth - 24);
            setPosition({
                left: Math.max(12, Math.min(collapsed ? rect.right + 12 : rect.left, window.innerWidth - width - 12)),
                bottom: Math.max(12, window.innerHeight - (collapsed ? rect.bottom : rect.top) + (collapsed ? 0 : 8)),
            });
        }
        setMenuOpen(!menuOpen);
    };
    const logout = async () => {
        if (signingOut) return;
        setSigningOut(true);
        setSignOutError("");
        try {
            await signOut();
            closeMenu();
            navigate("/");
        } catch {
            setSignOutError("Couldn't sign out. Check your connection and try again.");
        } finally { setSigningOut(false); }
    };
    const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        }
        if (event.key === "Tab") { event.stopPropagation(); closeMenu(true); }
    };
    const menu = menuOpen ? (
        <div ref={menuRef} id={menuId} className={`${styles.menu} ${sidebar ? styles.sidebarMenu : ""}`} role="menu" aria-label="Account" onKeyDown={menuKey}
            style={sidebar ? { left: position.left, bottom: position.bottom } : undefined}>
            <div className={styles.menuHeader}>
                <span className={styles.menuAvatar}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.charAt(0).toUpperCase()}</span>
                <div className={styles.menuIdentity}><div className={styles.menuName}>{user.name}</div><div className={styles.menuEmail}>{user.email}</div></div>
            </div>
            <button type="button" className={styles.menuItem} role="menuitem" onClick={() => { closeMenu(); navigate("/account"); }}>
                <IconUser size={18} aria-hidden="true" /><span>{sidebar ? "Profile and settings" : "Account settings"}{sidebar && <small>Profile, plan, history and privacy</small>}</span>
            </button>
            {onWalkthrough && <button type="button" className={styles.menuItem} role="menuitem" onClick={() => { closeMenu(); onWalkthrough(); }}>
                <IconPlayerPlay size={18} aria-hidden="true" /><span>Walkthrough<small>Replay the tour</small></span>
            </button>}
            <button type="button" className={`${styles.menuItem} ${styles.signOut}`} role="menuitem" disabled={signingOut} onClick={() => void logout()}>
                <IconLogout size={18} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}
            </button>
            {signOutError && <p className={styles.menuError} role="alert">{signOutError}</p>}
        </div>
    ) : null;

    return (
        <div className={`${styles.accountRoot} ${sidebar ? styles.sidebarRoot : ""}`} ref={rootRef}>
            <button ref={triggerRef} type="button" className={`${styles.accountTrigger} ${sidebar ? styles.sidebarTrigger : ""}`} onClick={toggle}
                aria-label={sidebar ? "Settings" : undefined} title={sidebar && collapsed ? "Settings" : undefined}
                aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}
                onKeyDown={(event) => { if (event.key === "ArrowDown" && !menuOpen) { event.preventDefault(); toggle(); } }}>
                {sidebar ? <IconSettings size={19} aria-hidden="true" /> : <span className={styles.avatar}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.name || user.email).charAt(0).toUpperCase()}</span>}
                {(!sidebar || !collapsed) && <span className={styles.accountEmail}>{sidebar ? "Settings" : user.hasCustomName ? user.name : user.email}</span>}
                {!sidebar && <IconChevronDown size={15} className={styles.chevron} aria-hidden="true" />}
            </button>
            {sidebar && (!collapsed) && <button type="button" className={styles.sidebarIdentity} onClick={() => navigate("/account")}>
                <span className={styles.menuAvatar}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.charAt(0).toUpperCase()}</span>
                <span className={styles.identityText}><strong>{user.hasCustomName ? user.name : user.email}</strong><small>View your profile</small></span>
            </button>}
            {sidebar && menu ? createPortal(menu, document.body) : menu}
        </div>
    );
}
