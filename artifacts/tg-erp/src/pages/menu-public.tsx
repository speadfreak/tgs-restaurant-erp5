import { useState } from "react";
import { useListMenuCategories, useListMenuItems, useListBranches } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Plus, Minus, Search } from "lucide-react";
import logoUrl from "@assets/ChatGPT_Image_Jun_30,_2026,_07_44_15_AM_1782796152927.png";

export default function PublicMenu() {
  const { data: categories } = useListMenuCategories({});
  const { data: items, isLoading } = useListMenuItems({ available: true });
  
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<Array<{ id: number; name: string; price: number; quantity: number }>>([]);
  const [search, setSearch] = useState("");

  const filteredItems = items?.filter(item => {
    const matchesCat = activeCategory ? item.categoryId === activeCategory : true;
    const matchesSearch = item.nameEn.toLowerCase().includes(search.toLowerCase()) || 
                          (item.nameAm && item.nameAm.includes(search));
    return matchesCat && matchesSearch;
  });

  const addToCart = (item: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { id: item.id, name: item.nameEn, price: item.priceAed, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQ = i.quantity + delta;
        return newQ > 0 ? { ...i, quantity: newQ } : i;
      }
      return i;
    }).filter(i => i.quantity > 0));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="TG's Restaurant" className="h-10 w-auto" />
            <h1 className="font-bold text-lg hidden sm:block">TG's Restaurant</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search menu..." 
                className="pl-9 bg-card/50" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" className="relative" onClick={() => document.getElementById('cart-drawer')?.classList.toggle('hidden')}>
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 flex gap-8">
        {/* Categories Sidebar */}
        <aside className="w-64 hidden lg:block shrink-0 sticky top-24 h-fit space-y-2">
          <h2 className="font-bold text-lg mb-4">Categories</h2>
          <Button 
            variant={activeCategory === null ? "default" : "ghost"} 
            className="w-full justify-start font-medium"
            onClick={() => setActiveCategory(null)}
          >
            All Items
          </Button>
          {categories?.map(cat => (
            <Button 
              key={cat.id}
              variant={activeCategory === cat.id ? "default" : "ghost"} 
              className="w-full justify-start font-medium"
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.nameEn}
            </Button>
          ))}
        </aside>

        {/* Menu Grid */}
        <div className="flex-1">
          {/* Mobile Category Scroller */}
          <div className="flex lg:hidden overflow-x-auto gap-2 pb-4 mb-6 scrollbar-hide -mx-4 px-4">
            <Badge 
              variant={activeCategory === null ? "default" : "outline"}
              className="px-4 py-2 cursor-pointer whitespace-nowrap text-sm"
              onClick={() => setActiveCategory(null)}
            >
              All
            </Badge>
            {categories?.map(cat => (
              <Badge 
                key={cat.id}
                variant={activeCategory === cat.id ? "default" : "outline"}
                className="px-4 py-2 cursor-pointer whitespace-nowrap text-sm"
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.nameEn}
              </Badge>
            ))}
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading our delicious menu...</div>
          ) : filteredItems?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No items found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredItems?.map(item => (
                <Card key={item.id} className="overflow-hidden bg-card/50 hover:border-primary/50 transition-colors group">
                  {item.photoUrl && (
                    <div className="h-48 bg-muted overflow-hidden">
                      <img src={item.photoUrl} alt={item.nameEn} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  )}
                  <CardContent className="p-4 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-bold text-lg leading-tight">{item.nameEn}</h3>
                        <p className="text-sm text-primary/80 mt-0.5 font-medium">{item.nameAm}</p>
                      </div>
                      <span className="font-bold text-primary ml-4 whitespace-nowrap">{item.priceAed} AED</span>
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{item.description}</p>
                    )}
                    
                    <div className="mt-6 flex items-center justify-between">
                      {cart.find(i => i.id === item.id) ? (
                        <div className="flex items-center gap-3 bg-muted rounded-full p-1 border border-border">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQuantity(item.id, -1)}>
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="font-bold w-4 text-center">{cart.find(i => i.id === item.id)?.quantity}</span>
                          <Button variant="default" size="icon" className="h-8 w-8 rounded-full" onClick={() => updateQuantity(item.id, 1)}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button className="w-full sm:w-auto" onClick={() => addToCart(item)}>
                          Add to Order
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Floating Cart for Mobile / Simple Drawer */}
      <div id="cart-drawer" className="fixed inset-y-0 right-0 w-full sm:w-96 bg-card border-l border-border shadow-2xl z-50 transform translate-x-0 hidden flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-muted/30">
          <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Your Order</h2>
          <Button variant="ghost" size="sm" onClick={() => document.getElementById('cart-drawer')?.classList.add('hidden')}>Close</Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Your cart is empty.</div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="flex justify-between items-center">
                <div>
                  <div className="font-medium text-sm">{item.name}</div>
                  <div className="text-primary font-bold text-sm">{item.price * item.quantity} AED</div>
                </div>
                <div className="flex items-center gap-2 bg-muted rounded-full p-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(item.id, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="font-bold w-4 text-center text-sm">{item.quantity}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(item.id, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t bg-muted/10 space-y-4">
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span className="text-primary">{cartTotal} AED</span>
          </div>
          <Button className="w-full h-12 text-lg font-bold" disabled={cart.length === 0}>
            Checkout via WhatsApp
          </Button>
        </div>
      </div>
      
    </div>
  );
}
