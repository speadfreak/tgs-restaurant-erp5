import { useState } from "react";
import { useListOrders, useUpdateOrderStatus } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { fmtUAE } from "@/lib/date-uae";
import { Link } from "wouter";
import { Plus, Search, ShoppingBag } from "lucide-react";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export default function Orders() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: orders, isLoading } = useListOrders({ 
    branchId: user?.branchId ?? undefined,
    status: statusFilter === "all" ? undefined : statusFilter
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-1">Manage and track customer orders.</p>
        </div>
        <Link href="/orders/new">
          <div className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 cursor-pointer">
            <Plus className="mr-2 h-4 w-4" /> New Order
          </div>
        </Link>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <CardTitle>All Orders</CardTitle>
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search orders..." className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="preparing">Preparing</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">Loading orders...</div>
          ) : orders && orders.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order Code</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono font-medium">{order.orderCode}</TableCell>
                      <TableCell>{fmtUAE(order.createdAt)}</TableCell>
                      <TableCell>{order.customerName || "—"}</TableCell>
                      <TableCell className="capitalize">{order.channel}</TableCell>
                      <TableCell className="font-semibold">{order.totalAed} AED</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(order.status)}>
                          {order.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty><EmptyTitle>No orders found</EmptyTitle><EmptyDescription>Try adjusting your filters.</EmptyDescription></Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
    case 'confirmed': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
    case 'preparing': return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50';
    case 'ready': return 'bg-cyan-500/20 text-cyan-500 border-cyan-500/50';
    case 'out_for_delivery': return 'bg-purple-500/20 text-purple-500 border-purple-500/50';
    case 'delivered': return 'bg-green-500/20 text-green-500 border-green-500/50';
    case 'cancelled': return 'bg-red-500/20 text-red-500 border-red-500/50';
    default: return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
  }
}
