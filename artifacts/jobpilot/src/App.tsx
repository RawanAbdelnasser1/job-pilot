import { useEffect, useRef } from "react";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "sonner";
import { Shell } from "@/components/layout/shell";

import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import Tailoring from "@/pages/tailoring";
import Applications from "@/pages/applications";
import Batch from "@/pages/batch";
import Profile from "@/pages/profile";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";

// Ensure Clerk resolves the correct key based on incoming host
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

// Map the jobpilot variables
//  --background: 210 40% 98%; => hsl(210 40% 98%) => #f7f9fc
//  --foreground: 222 47% 11%; => hsl(222 47% 11%) => #0f172a
//  --muted: 214 32% 91%; => hsl(214 32% 91%) => #e2e8f0
//  --muted-foreground: 215 16% 47%; => hsl(215 16% 47%) => #64748b
//  --primary: 226 71% 40%; => hsl(226 71% 40%) => #1d4ed8
//  --accent: 24 95% 53%; => hsl(24 95% 53%) => #f97316
//  --destructive: 0 84% 60%; => hsl(0 84% 60%) => #ef4444
//  --border: 214 32% 91%; => hsl(214 32% 91%) => #e2e8f0
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(226 71% 40%)", // primary
    colorForeground: "hsl(222 47% 11%)", // foreground
    colorMutedForeground: "hsl(215 16% 47%)", // muted-foreground
    colorDanger: "hsl(0 84% 60%)", // destructive
    colorBackground: "hsl(0 0% 100%)", // card (white)
    colorInput: "hsl(210 40% 98%)", // background/input
    colorInputForeground: "hsl(222 47% 11%)", // foreground
    colorNeutral: "hsl(214 32% 91%)", // border
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-sm border border-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-serif font-bold text-2xl",
    headerSubtitle: "text-muted-foreground font-sans",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary font-medium hover:text-primary/90",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-600",
    alertText: "text-destructive",
    logoBox: "mb-4",
    logoImage: "h-8",
    socialButtonsBlockButton: "border-border hover:bg-muted/50 transition-colors",
    formButtonPrimary: "bg-primary hover:bg-primary/90 text-white shadow-sm transition-all",
    formFieldInput: "bg-background border-input focus:ring-ring focus:border-ring text-foreground",
    footerAction: "bg-muted/30 pt-4 pb-6",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/20",
    otpCodeFieldInput: "bg-background border-input focus:ring-ring text-foreground",
    formFieldRow: "mb-4",
    main: "px-8 py-6",
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component, ...rest }: { component: React.ComponentType<any>; [key: string]: any }) {
  return (
    <Route {...rest}>
      {(params) => (
        <>
          <Show when="signed-in">
            <Component params={params} />
          </Show>
          <Show when="signed-out">
            <Redirect to="/sign-in" />
          </Show>
        </>
      )}
    </Route>
  );
}

function ProtectedShellRoutes() {
  return (
    <Shell>
      <Switch>
        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <ProtectedRoute path="/jobs" component={Jobs} />
        <ProtectedRoute path="/jobs/:id/tailoring" component={Tailoring} />
        <ProtectedRoute path="/applications" component={Applications} />
        <ProtectedRoute path="/batch" component={Batch} />
        <ProtectedRoute path="/profile" component={Profile} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access your account",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Get started today",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ErrorBoundary>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            {/* All other routes are protected inside the Shell */}
            <Route component={ProtectedShellRoutes} />
          </Switch>
        </ErrorBoundary>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
