import { useState } from "react";
import { 
  useListBranches, 
  useListCustomers, 
  useListMenuItems, 
  useCreateOrder,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ShoppingCart, Plus, Minus, Trash2 } from "lucide-react";

export default function NewOrder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [branchId, setBranchId] = useState<string>(user?.branchId?.toString() || "");
  const [customerId, setCustomerId] = useState<string>("");
  const [channel, setChannel] = useState<"whatsapp_relay" | "webapp">("whatsapp_relay");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [cart, setCart] = useState<Array<{ menuItemId: number; name: string; price: number; quantity: number; notes: string }>>([]);

  const { data: branches } = useListBranches();
  const { data: customers } = useListCustomers({});
  const { data: menuItems, isLoading: loadingMenu } = useListMenuItems({ available: true });

  const createOrder = useCreateOrder();

  const addToCart = (item: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.menuItemId === item.id);
      if (existing) {
        return prev.map(i => i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { menuItemId: item.id, name: item.nameEn, price: item.priceAed, quantity: 1, notes: "" }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.menuItemId === id) {
        const newQ = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQ };
      }
      return i;
    }));
  };

  const removeItem = (id: number) => {
    setCart(prev => prev.filter(i => i.menuItemId !== id));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleSubmit = (): void => {
    if (!branchId) { toast({ title: "Error", description: "Select a branch first", variant: "destructive" }); return; }
    if (cart.length === 0) { toast({ title: "Error", description: "Cart is empty", variant: "destructive" }); return; }

    const orderData = {
      branchId: parseInt(branchId),
      customerId: customerId ? parseInt(customerId) : undefined,
      channel,
      paymentMethod,
      items: cart.map(item => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: item.price,
        notes: item.notes || undefined
      }))
    };

    createOrder.mutate({ data: orderData }, {
      onSuccess: () => {
        toast({ title: "Order created successfully" });
        setLocation("/orders");
      }
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <h1 className="text-3xl font-bold">New Order</h1>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="Select Branch" /></SelectTrigger>
              <SelectContent>
                {branches?.map(b => (
                  <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Customer (optional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Guest / no account" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Guest (no account)</SelectItem>
                {customers?.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.name} ({c.phone})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as "whatsapp_relay" | "webapp")}>
              <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp_relay">WhatsApp Relay</SelectItem>
                <SelectItem value="webapp">Web Order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="transfer">Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Menu Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {loadingMenu ? <p>Loading menu...</p> : menuItems?.map(item => (
                <div 
                  key={item.id} 
                  className="p-4 border rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
                  onClick={() => addToCart(item)}
                >
                  <div className="font-semibold">{item.nameEn}</div>
                  <div className="text-sm text-muted-foreground">{item.nameAm}</div>
                  <div className="mt-2 text-primary font-bold">{item.priceAed} AED</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="sticky top-6">
          <CardHeader className="bg-muted/50 border-b">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Current Order
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
            {cart.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">Cart is empty</div>
            ) : (
              cart.map(item => (
                <div key={item.menuItemId} className="flex flex-col gap-2 p-3 border rounded-md">
                  <div className="flex justify-between items-start">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-bold">{item.price * item.quantity} AED</div>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.menuItemId, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-4 text-center text-sm">{item.quantity}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.menuItemId, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(item.menuItemId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input 
                    placeholder="Notes..." 
                    className="h-8 text-sm mt-1" 
                    value={item.notes}
                    onChange={(e) => setCart(prev => prev.map(i => i.menuItemId === item.menuItemId ? { ...i, notes: e.target.value } : i))}
                  />
                </div>
              ))
            )}
          </CardContent>
          <CardFooter className="flex-col gap-4 border-t p-4 bg-muted/20">
            <div className="flex justify-between w-full text-lg font-bold">
              <span>Total</span>
              <span className="text-primary">{total} AED</span>
            </div>
            <Button 
              className="w-full h-12 text-lg font-bold" 
              disabled={cart.length === 0 || createOrder.isPending}
              onClick={handleSubmit}
            >
              {createOrder.isPending ? "Processing..." : "Place Order"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
