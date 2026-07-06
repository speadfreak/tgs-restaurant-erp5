import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingBag, ChefHat, Truck, Menu as MenuIcon,
  Users, Package, DollarSign, Clock, Trophy, Settings, LogOut,
  Store, Activity, RotateCcw, MessageSquare, Globe, ChevronLeft,
  ChevronRight, Zap, BarChart2, AlignJustify, X, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import logoUrl from "@assets/ChatGPT_Image_Jun_30,_2026,_07_44_15_AM_1782796152927.png";

interface AppLayoutProps { children: React.ReactNode }

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
      { href: "/orders", label: "Orders", icon: ShoppingBag },
      { href: "/kitchen", label: "Kitchen", icon: ChefHat },
      { href: "/deliveries", label: "Deliveries", icon: Truck },
      { href: "/order-queue", label: "Order Queue", icon: MessageSquare, roles: ["super_admin","branch_manager","order_intake"] },
    ],
  },
  {
    label: "Menu & Customers",
    items: [
      { href: "/menu", label: "Menu", icon: MenuIcon },
      { href: "/customers", label: "Customers", icon: Users },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/restock", label: "Restock", icon: RotateCcw },
      { href: "/addis", label: "Addis Supply Chain", icon: Globe, roles: ["super_admin","branch_manager","addis_staff"] },
    ],
  },
  {
    label: "Finance & HR",
    items: [
      { href: "/finance", label: "Finance", icon: DollarSign, roles: ["super_admin", "branch_manager"] },
      { href: "/payroll", label: "Payroll", icon: Clock, roles: ["super_admin", "branch_manager"] },
      { href: "/staff", label: "Staff", icon: Settings, roles: ["super_admin", "branch_manager"] },
      { href: "/earnings", label: "My Earnings", icon: TrendingUp },
    ],
  },
  {
    label: "Engagement",
    items: [
      { href: "/lottery", label: "Lottery Engine", icon: Trophy },
      { href: "/activities", label: "Activities", icon: Activity },
      { href: "/branches", label: "Branches", icon: Store, roles: ["super_admin"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/audit", label: "Audit & Reports", icon: BarChart2, roles: ["super_admin", "branch_manager"] },
      { href: "/settings", label: "Settings", icon: Zap, roles: ["super_admin"] },
    ],
  },
];

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="cinema-title text-2xl animate-pulse">Loading...</div>
      </div>
    );
  }

  const canAccess = (item: NavItem) => {
    if (!item.roles) return true;
    return item.roles.includes(user.role);
  };

  const initials = user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = user.role.replace(/_/g, " ");

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      {/* Logo area */}
      <div className={cn(
        "flex items-center border-b py-4 transition-all duration-300",
        (collapsed && !mobile) ? "px-3 justify-center" : "px-5 gap-3"
      )} style={{ borderBottomColor: "hsl(38 30% 10%)" }}>
        <div className="relative flex-shrink-0">
          <img src={logoUrl} alt="TG" className="h-8 w-8 object-contain rounded-full ring-1 ring-amber-500/40" />
          <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-black" />
        </div>
        {(!collapsed || mobile) && (
          <div className="overflow-hidden flex-1">
            <div className="cinema-title-sm text-sm text-amber-400 leading-tight whitespace-nowrap">TG's ERP</div>
            <div className="cinema-subtitle whitespace-nowrap">Command Center</div>
          </div>
        )}
        {mobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto p-1.5 rounded-lg text-zinc-600 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 scrollbar-hide px-2">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(canAccess);
          if (!visibleItems.length) return null;
          return (
            <div key={group.label} className="mb-1">
              {(!collapsed || mobile) && (
                <div className="px-2 py-1.5 mb-1">
                  <span className="text-[9px] font-bold tracking-[0.2em] uppercase"
                    style={{ color: "hsl(38 30% 35%)" }}>{group.label}</span>
                </div>
              )}
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href || location.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "sidebar-nav-item flex items-center gap-2.5 rounded-md text-sm font-medium transition-all cursor-pointer mb-0.5",
                        (collapsed && !mobile) ? "justify-center px-2 py-2.5" : "px-2.5 py-2.5",
                        isActive
                          ? "active bg-amber-500/10 text-amber-400"
                          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/4"
                      )}
                    >
                      <Icon className={cn("flex-shrink-0 transition-colors", isActive ? "text-amber-400" : "text-zinc-600", (collapsed && !mobile) ? "h-[18px] w-[18px]" : "h-4 w-4")} />
                      {(!collapsed || mobile) && (
                        <span className={cn("truncate leading-none", isActive && "text-amber-300")}>{item.label}</span>
                      )}
                      {(!collapsed || mobile) && item.badge && (
                        <span className="ml-auto text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom — User */}
      <div className="border-t p-3 space-y-2" style={{ borderTopColor: "hsl(38 30% 10%)" }}>
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-2.5 px-1.5">
            <div className="h-8 w-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0"
              style={{ background: "hsl(38 50% 15%)", color: "hsl(38 88% 60%)", border: "1px solid hsl(38 88% 52% / 0.3)" }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-200 truncate leading-none">{user.name}</p>
              <p className="text-[10px] capitalize leading-none mt-0.5" style={{ color: "hsl(38 50% 45%)" }}>{roleLabel}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={logout} title="Sign out" className="w-full flex justify-center text-zinc-600 hover:text-red-400 transition-colors p-1.5 rounded">
            <LogOut className="h-4 w-4" />
          </button>
        )}
        {!mobile && (
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded text-zinc-600 hover:text-amber-400 hover:bg-amber-500/5 transition-colors text-xs"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            {!collapsed && <span className="text-[10px] tracking-wider uppercase">Collapse</span>}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── DESKTOP SIDEBAR ───────────────────────── */}
      <aside
        className={cn(
          "flex-shrink-0 flex flex-col transition-all duration-300 ease-in-out relative",
          "border-r overflow-hidden",
          "hidden md:flex",
          collapsed ? "w-[60px]" : "w-[228px]"
        )}
        style={{
          background: "hsl(0 0% 2%)",
          borderRightColor: "hsl(38 30% 10%)",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.8), transparent)" }} />
        <SidebarContent />
      </aside>

      {/* ── MOBILE OVERLAY ────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(2px)" }}
        />
      )}

      {/* ── MOBILE DRAWER ─────────────────────────── */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-full z-50 flex flex-col transition-transform duration-300 ease-in-out",
          "md:hidden w-[280px] border-r overflow-hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          background: "hsl(0 0% 2%)",
          borderRightColor: "hsl(38 30% 10%)",
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.8), transparent)" }} />
        <SidebarContent mobile />
      </aside>

      {/* ── MAIN ──────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center gap-3 px-4 py-3 border-b flex-shrink-0 sticky top-0 z-30"
          style={{ background: "hsl(0 0% 2%)", borderBottomColor: "hsl(38 30% 10%)" }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <AlignJustify className="h-5 w-5" />
          </button>
          <img src={logoUrl} alt="TG" className="h-6 w-6 object-contain rounded-full ring-1 ring-amber-500/30" />
          <span className="cinema-title-sm text-sm text-amber-400 leading-none">TG's ERP</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="h-7 w-7 rounded-full flex items-center justify-center font-black text-[10px]"
              style={{ background: "hsl(38 50% 15%)", color: "hsl(38 88% 60%)", border: "1px solid hsl(38 88% 52% / 0.3)" }}>
              {initials}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
