import { useState } from "react";
import { useGetKitchenQueue, useStartPreparingOrder, useMarkOrderReady } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, ChefHat, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetKitchenQueueQueryKey } from "@workspace/api-client-react";

export default function Kitchen() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tickets, isLoading } = useGetKitchenQueue(
    { branchId: user?.branchId ?? undefined },
    { query: { refetchInterval: 10000, queryKey: getGetKitchenQueueQueryKey({ branchId: user?.branchId ?? undefined }) } }
  );

  const startPreparing = useStartPreparingOrder();
  const markReady = useMarkOrderReady();

  const handleStartPreparing = (orderId: number) => {
    startPreparing.mutate({ id: orderId }, {
      onSuccess: () => {
        toast({ title: "Order started", description: "Kitchen ticket updated." });
        queryClient.invalidateQueries({ queryKey: getGetKitchenQueueQueryKey({ branchId: user?.branchId ?? undefined }) });
      }
    });
  };

  const handleMarkReady = (orderId: number) => {
    markReady.mutate({ id: orderId }, {
      onSuccess: () => {
        toast({ title: "Order ready", description: "Ticket marked as ready." });
        queryClient.invalidateQueries({ queryKey: getGetKitchenQueueQueryKey({ branchId: user?.branchId ?? undefined }) });
      }
    });
  };

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-theme(spacing.16))] flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ChefHat className="h-8 w-8" />
            Kitchen Display
          </h1>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground bg-card px-4 py-2 rounded-full border border-border">
          <Clock className="h-4 w-4" />
          <span className="font-mono text-sm">{format(new Date(), 'HH:mm')}</span>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max h-full">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => (
              <Card key={i} className="w-80 shrink-0 bg-card/50">
                <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
                <CardContent><Skeleton className="h-32 w-full" /></CardContent>
              </Card>
            ))
          ) : tickets && tickets.length > 0 ? (
            tickets.map(ticket => (
              <TicketCard 
                key={ticket.id} 
                ticket={ticket} 
                onStart={() => handleStartPreparing(ticket.id)}
                onReady={() => handleMarkReady(ticket.id)}
                isStarting={startPreparing.isPending}
                isReadying={markReady.isPending}
              />
            ))
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Empty><EmptyTitle>Kitchen is clear</EmptyTitle><EmptyDescription>No active tickets.</EmptyDescription></Empty>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TicketCard({ ticket, onStart, onReady, isStarting, isReadying }: any) {
  const isPending = ticket.status === 'confirmed';
  const isPreparing = ticket.status === 'preparing';
  
  const elapsed = ticket.elapsedMinutes || 0;
  let headerColor = "bg-card";
  let textColor = "text-foreground";
  
  if (isPreparing) {
    if (elapsed > 20) { headerColor = "bg-red-500/20 border-red-500/50"; textColor = "text-red-500"; }
    else if (elapsed > 10) { headerColor = "bg-yellow-500/20 border-yellow-500/50"; textColor = "text-yellow-500"; }
    else { headerColor = "bg-green-500/20 border-green-500/50"; textColor = "text-green-500"; }
  } else {
    headerColor = "bg-blue-500/10 border-blue-500/30";
  }

  return (
    <Card className={`w-80 shrink-0 flex flex-col border-2 overflow-hidden ${headerColor}`}>
      <CardHeader className={`p-4 border-b ${headerColor}`}>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="font-mono text-2xl font-bold">{ticket.orderCode}</CardTitle>
            <div className="text-sm opacity-80 mt-1">{ticket.customerName || 'Delivery'}</div>
          </div>
          <div className={`font-mono text-xl font-bold ${textColor}`}>
            {elapsed}m
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-y-auto bg-background/95 backdrop-blur">
        <ul className="divide-y divide-border/50">
          {ticket.items.map((item: any) => (
            <li key={item.id} className="p-4">
              <div className="flex items-start gap-3 text-lg">
                <span className="font-bold text-primary min-w-[2ch]">{item.quantity}x</span>
                <div>
                  <div className="font-semibold">{item.menuItemName}</div>
                  {item.notes && (
                    <div className="text-sm text-orange-400 mt-1 italic">Note: {item.notes}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {ticket.notes && (
          <div className="p-4 bg-orange-500/10 border-t border-orange-500/20">
            <div className="text-sm font-semibold text-orange-500 mb-1">Order Notes:</div>
            <div className="text-sm">{ticket.notes}</div>
          </div>
        )}
      </CardContent>
      <CardFooter className="p-4 bg-background border-t border-border">
        {isPending ? (
          <Button 
            className="w-full h-14 text-lg font-bold" 
            onClick={onStart}
            disabled={isStarting}
          >
            Start Preparing
          </Button>
        ) : isPreparing ? (
          <Button 
            className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white" 
            onClick={onReady}
            disabled={isReadying}
          >
            <CheckCircle className="mr-2 h-6 w-6" /> Mark Ready
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
