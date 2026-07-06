import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import logoUrl from "@assets/ChatGPT_Image_Jun_30,_2026,_07_44_15_AM_1782796152927.png";
import { Loader2, Lock, Phone } from "lucide-react";

const loginSchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const loginMutation = useLogin();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  function onSubmit(values: z.infer<typeof loginSchema>) {
    loginMutation.mutate({ data: values }, {
      onSuccess: (data) => {
        login(data.token, (data as { token: string; user?: { role?: string } }).user?.role);
        toast({ title: "Access granted", description: "Welcome to TG's Command Center" });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "";
        const isLocked = msg.includes("429") || msg.toLowerCase().includes("locked");
        toast({
          variant: "destructive",
          title: isLocked ? "Account locked" : "Access denied",
          description: isLocked
            ? "Too many failed attempts. Contact your manager to unlock."
            : "Invalid credentials. Check your phone number and password.",
        });
      },
    });
  }

  return (
    <div
      className="min-h-screen flex flex-col justify-center items-center px-4 relative overflow-hidden"
      style={{ background: "hsl(0 0% 3%)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 60% 50% at 50% 0%, hsl(38 88% 52% / 0.08) 0%, transparent 70%)",
        }}
      />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 50%, hsl(0 0% 2% / 0.6) 100%)"
      }} />
      <div className="absolute top-0 left-0 right-0 h-[1px]"
        style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.6), transparent)" }} />

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-5">
            <div
              className="absolute inset-0 rounded-full blur-2xl"
              style={{ background: "hsl(38 88% 52% / 0.2)", transform: "scale(1.5)" }}
            />
            <img
              src={logoUrl}
              alt="TG's Restaurant"
              className="relative h-20 w-20 object-contain rounded-full"
              style={{ boxShadow: "0 0 0 2px hsl(38 88% 52% / 0.4), 0 0 40px hsl(38 88% 52% / 0.2)" }}
            />
          </div>
          <h1 className="cinema-title text-3xl tracking-widest text-center mb-1">Command Center</h1>
          <p className="cinema-subtitle text-center">ቲጂ ምግብ ቤት — TG's Restaurant ERP</p>
        </div>

        <div
          className="cinema-card rounded-2xl p-6 sm:p-8"
          style={{ background: "hsl(24 8% 6%)" }}
        >
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-400 text-xs uppercase tracking-wider">Phone Number</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
                        <Input
                          placeholder="+971 xx xxx xxxx"
                          {...field}
                          className="pl-9 border-zinc-700/60 focus:border-amber-500/50 bg-black/30 text-zinc-100"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-400 text-xs uppercase tracking-wider">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                          className="pl-9 border-zinc-700/60 focus:border-amber-500/50 bg-black/30 text-zinc-100"
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="btn-cinema w-full h-12 flex items-center justify-center gap-2 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
              </button>
            </form>
          </Form>
        </div>

        <p className="text-center text-zinc-700 text-xs mt-6">
          TG's Restaurant ERP · Internal System · Authorized Access Only
        </p>
      </div>
    </div>
  );
}
