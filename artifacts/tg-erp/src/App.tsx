import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Kitchen from "@/pages/kitchen";
import Orders from "@/pages/orders";
import NewOrder from "@/pages/orders-new";
import Deliveries from "@/pages/deliveries";
import Menu from "@/pages/menu";
import Customers from "@/pages/customers";
import Inventory from "@/pages/inventory";
import Finance from "@/pages/finance";
import Payroll from "@/pages/payroll";
import Lottery from "@/pages/lottery";
import Branches from "@/pages/branches";
import Staff from "@/pages/staff";
import OrderQueue from "@/pages/order-queue";
import AddisPage from "@/pages/addis";
import AuditPage from "@/pages/audit";
import SettingsPage from "@/pages/settings";

// Portals (no sidebar layout)
import ChefPortal from "@/pages/chef-portal";
import DeliveryPortal from "@/pages/delivery-portal";

// Public Pages
import OrderTracker from "@/pages/track";
import PublicMenu from "@/pages/menu-public";
import OrderPublic from "@/pages/order-public";
import RestockAdmin from "@/pages/restock-admin";
import ActivitiesAdmin from "@/pages/activities-admin";
import MyLuckyNumber from "@/pages/my-lucky-number";
import Earnings from "@/pages/earnings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      <Route path="/track/:code" component={OrderTracker} />
      <Route path="/menu-public" component={PublicMenu} />
      <Route path="/order" component={OrderPublic} />

      {/* Dedicated portals — no admin sidebar */}
      <Route path="/chef" component={ChefPortal} />
      <Route path="/delivery" component={DeliveryPortal} />

      {/* Admin / Manager routes inside AppLayout */}
      <Route path="/"><AppLayout><Dashboard /></AppLayout></Route>
      <Route path="/dashboard"><AppLayout><Dashboard /></AppLayout></Route>
      <Route path="/orders"><AppLayout><Orders /></AppLayout></Route>
      <Route path="/orders/new"><AppLayout><NewOrder /></AppLayout></Route>
      <Route path="/kitchen"><AppLayout><Kitchen /></AppLayout></Route>
      <Route path="/deliveries"><AppLayout><Deliveries /></AppLayout></Route>
      <Route path="/menu"><AppLayout><Menu /></AppLayout></Route>
      <Route path="/customers"><AppLayout><Customers /></AppLayout></Route>
      <Route path="/inventory"><AppLayout><Inventory /></AppLayout></Route>
      <Route path="/finance"><AppLayout><Finance /></AppLayout></Route>
      <Route path="/payroll"><AppLayout><Payroll /></AppLayout></Route>
      <Route path="/lottery"><AppLayout><Lottery /></AppLayout></Route>
      <Route path="/branches"><AppLayout><Branches /></AppLayout></Route>
      <Route path="/staff"><AppLayout><Staff /></AppLayout></Route>
      <Route path="/restock"><AppLayout><RestockAdmin /></AppLayout></Route>
      <Route path="/activities"><AppLayout><ActivitiesAdmin /></AppLayout></Route>
      <Route path="/order-queue"><AppLayout><OrderQueue /></AppLayout></Route>
      <Route path="/addis"><AppLayout><AddisPage /></AppLayout></Route>
      <Route path="/audit"><AppLayout><AuditPage /></AppLayout></Route>
      <Route path="/settings"><AppLayout><SettingsPage /></AppLayout></Route>
      <Route path="/earnings"><AppLayout><Earnings /></AppLayout></Route>

      {/* Public customer portal */}
      <Route path="/lucky" component={MyLuckyNumber} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
