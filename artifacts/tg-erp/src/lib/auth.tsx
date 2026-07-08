import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, User } from "@workspace/api-client-react";
import { setAuthTokenGetter, getGetMeQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string, role?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function roleDefaultPath(role?: string): string {
  if (role === "kitchen_staff") return "/chef";
  if (role === "delivery_staff") return "/delivery";
  if (role === "addis_staff") return "/addis";
  if (role === "finance_staff") return "/finance-portal";
  if (role === "order_staff") return "/order-queue";
  return "/dashboard";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("tg_erp_token"));
  const [, setLocation] = useLocation();

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("tg_erp_token"));
  }, []);

  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  useEffect(() => {
    if (!token) {
      const isPublicRoute = window.location.pathname.startsWith("/track/") || window.location.pathname === "/menu-public" || window.location.pathname === "/login" || window.location.pathname === "/lucky" || window.location.pathname === "/order";
      if (!isPublicRoute) {
        setLocation("/login");
      }
    }
  }, [token, setLocation]);

  const login = (newToken: string, role?: string) => {
    localStorage.setItem("tg_erp_token", newToken);
    setTokenState(newToken);
    setAuthTokenGetter(() => newToken);
    refetch();
    setLocation(roleDefaultPath(role));
  };

  const logout = () => {
    localStorage.removeItem("tg_erp_token");
    setTokenState(null);
    setAuthTokenGetter(() => null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading: isLoading && !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
