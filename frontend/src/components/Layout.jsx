import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import logo from "../GES-logo.webp";
import { getUser, clearToken } from "../auth";

const s = {
  shell: { minHeight: "100vh", display: "flex", flexDirection: "column", background: "#0c2536" },
  header: {
    background: "#cdd0d0", borderBottom: "3px solid #7dc3cd", padding: "0 24px",
    height: 64, display: "flex", alignItems: "center", gap: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)", justifyContent: "space-between",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  roleChip: (role) => ({
    fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
    background: role === "admin" ? "#063c59" : "#0e5278",
    color: role === "admin" ? "#c3d735" : "#7dc3cd",
    textTransform: "uppercase", letterSpacing: "0.06em",
  }),
  userLabel: { fontSize: 13, color: "#063c59", fontWeight: 600 },
  logoutBtn: {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", borderRadius: 5, border: "1px solid #0e5278",
    background: "transparent", cursor: "pointer",
    fontSize: 12, color: "#063c59", fontWeight: 600,
  },
  logo: { display: "flex", alignItems: "center", gap: 14, textDecoration: "none" },
  divider: { width: 1, height: 30, background: "#063c59", opacity: 0.3 },
  logoText: { fontWeight: 700, fontSize: 16, color: "#063c59", letterSpacing: "0.02em" },
  breadcrumb: { display: "flex", alignItems: "center", gap: 6, marginLeft: 24, fontSize: 13, color: "#063c59" },
  main: { flex: 1, padding: "28px 24px" },
};

export default function Layout({ children }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const user = getUser();
  const parts = loc.pathname.split("/").filter(Boolean);

  const crumbs = [{ label: "Dashboard", to: "/" }];
  if (parts[0] === "workflow" && parts.length >= 5) {
    const [, subId, rg, site, name] = parts;
    crumbs.push({ label: `${site} / ${name}`, to: `/workflow/${subId}/${rg}/${site}/${name}` });
    if (parts[5] === "run" && parts[6]) {
      crumbs.push({ label: `Run ${parts[6].slice(0, 8)}...`, to: null });
    }
  }

  const logout = () => { clearToken(); navigate("/login", { replace: true }); };

  return (
    <div style={s.shell}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <Link to="/" style={s.logo}>
            <img src={logo} alt="GES" style={{ height: 34, width: "auto", objectFit: "contain" }} />
            <div style={s.divider} />
            <span style={s.logoText}>AIS Dashboard</span>
          </Link>
          {crumbs.length > 1 && (
            <nav style={s.breadcrumb}>
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight size={12} style={{ color: "#0e5278" }} />}
                  {c.to ? (
                    <Link to={c.to} style={{ color: i === crumbs.length - 1 ? "#063c59" : "#0e5278", textDecoration: "none", fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>
                      {c.label}
                    </Link>
                  ) : (
                    <span style={{ color: "#063c59", fontWeight: 600 }}>{c.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          )}
        </div>
        {user && (
          <div style={s.headerRight}>
            <span style={s.userLabel}>{user.username}</span>
            <span style={s.roleChip(user.role)}>{user.role}</span>
            <button style={s.logoutBtn} onClick={logout}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        )}
      </header>
      <main style={s.main}>{children}</main>
    </div>
  );
}
