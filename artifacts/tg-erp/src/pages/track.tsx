import { useParams } from "wouter";
import { useGetOrderByCode, getGetOrderByCodeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Clock, UtensilsCrossed, Truck, Home } from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jun_30,_2026,_07_44_15_AM_1782796152927.png";

export default function OrderTracker() {
  const { code } = useParams();
  
  const { data: order, isLoading, isError } = useGetOrderByCode(code || "", {
    query: {
      enabled: !!code,
      refetchInterval: 10000,
      queryKey: getGetOrderByCodeQueryKey(code || ""),
    }
  });

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-primary">Loading order details...</div>;
  }

  if (isError || !order) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <img src={logoUrl} alt="TG's Restaurant" className="h-16 mb-8 opacity-50" />
        <h1 className="text-2xl font-bold text-destructive mb-2">Order Not Found</h1>
        <p className="text-muted-foreground">Please check your tracking code and try again.</p>
      </div>
    );
  }

  const steps = [
    { id: 'pending', label: 'Order Received', icon: Clock },
    { id: 'confirmed', label: 'Confirmed', icon: CheckCircle2 },
    { id: 'preparing', label: 'Preparing', icon: UtensilsCrossed },
    { id: 'out_for_delivery', label: 'Out for Delivery', icon: Truck },
    { id: 'delivered', label: 'Delivered', icon: Home },
  ];

  const getStepIndex = (status: string) => {
    if (status === 'cancelled') return -1;
    if (status === 'ready') return 2; // Treat ready as part of preparing visually
    const idx = steps.findIndex(s => s.id === status);
    return idx === -1 ? 0 : idx;
  };

  const currentIndex = getStepIndex(order.status);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-12 px-4">
      <img src={logoUrl} alt="TG's Restaurant" className="h-16 mb-8 drop-shadow-xl" />
      
      <Card className="w-full max-w-lg border-primary/20 bg-card/80 backdrop-blur-md shadow-2xl">
        <CardHeader className="text-center pb-8 border-b border-border/50">
          <Badge variant="outline" className="w-fit mx-auto mb-4 bg-primary/10 text-primary border-primary/30">
            Order #{order.orderCode}
          </Badge>
          <CardTitle className="text-3xl font-bold">
            {order.status === 'delivered' ? 'Enjoy your meal!' : 
             order.status === 'cancelled' ? 'Order Cancelled' : 
             'Track your order'}
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            {order.customerName ? `Hi ${order.customerName}, your ` : 'Your '} order from {order.branchName}
          </p>
        </CardHeader>
        
        <CardContent className="pt-8">
          {order.status === 'cancelled' ? (
            <div className="text-center py-8 text-destructive border border-destructive/20 rounded-xl bg-destructive/5">
              <p className="font-bold text-lg">This order has been cancelled.</p>
              <p className="text-sm mt-1">Please contact the restaurant for more info.</p>
            </div>
          ) : (
            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
              {steps.map((step, idx) => {
                const isCompleted = idx <= currentIndex;
                const isCurrent = idx === currentIndex;
                const Icon = step.icon;
                
                return (
                  <div key={step.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow transition-colors duration-300 ${
                      isCurrent ? 'border-primary text-primary ring-4 ring-primary/20' : 
                      isCompleted ? 'border-primary bg-primary text-primary-foreground' : 
                      'border-muted text-muted-foreground'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border bg-card/50 shadow-sm transition-all duration-300">
                      <div className="flex items-center justify-between space-x-2 mb-1">
                        <div className={`font-bold ${isCurrent ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {step.label}
                        </div>
                      </div>
                      {isCurrent && (
                        <div className="text-sm text-muted-foreground">
                          {step.id === 'preparing' ? 'Our chefs are cooking your meal.' :
                           step.id === 'out_for_delivery' ? 'Your driver is on the way.' : 
                           'We are processing your request.'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-12 pt-6 border-t border-border/50">
            <h3 className="font-semibold text-lg mb-4">Order Details</h3>
            <div className="space-y-3">
              {order.items?.map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground"><span className="font-bold text-foreground mr-2">{item.quantity}x</span> {item.menuItemName}</span>
                  <span className="font-medium">{item.quantity * item.unitPrice} AED</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-border/50 font-bold text-lg">
              <span>Total</span>
              <span className="text-primary">{order.totalAed} AED</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
