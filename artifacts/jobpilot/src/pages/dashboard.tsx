import * as React from "react";
import {
  getGetDashboardQueryKey,
  getListActivityQueryKey,
  useGetDashboard,
  useListActivity,
  useSyncRecruiterTracking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { formatDate } from "@/lib/utils";
import { 
  Radar, 
  Send, 
  Clock, 
  CheckCircle2, 
  TrendingUp, 
  Activity,
  ArrowRight,
  Mail,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading: isLoadingDash } = useGetDashboard();
  const { data: activities, isLoading: isLoadingAct } = useListActivity();
  const syncTracking = useSyncRecruiterTracking();

  const refreshTrackingQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListActivityQueryKey() });
  };

  const handleSyncTracking = () => {
    syncTracking.mutate(undefined, {
      onSuccess: (result) => {
        refreshTrackingQueries();
        toast.success(
          result.newMessages
            ? `Found ${result.newMessages} new recruiter message${result.newMessages === 1 ? "" : "s"}.`
            : "No new recruiter messages found.",
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Could not sync Gmail.");
      },
    });
  };

  React.useEffect(() => {
    syncTracking.mutate(undefined, {
      onSuccess: refreshTrackingQueries,
    });
  }, []);

  if (isLoadingDash || isLoadingAct) {
    return <Loader />;
  }

  if (!dashboard) {
    return <div>Failed to load dashboard data.</div>;
  }

  const limitPercentage = (dashboard.dailyUsed / dashboard.dailyLimit) * 100;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Operational Overview</h1>
          <p className="text-muted-foreground mt-1 text-sm">Real-time status of your application pipeline.</p>
        </div>
        <Button
          variant="outline"
          onClick={handleSyncTracking}
          disabled={syncTracking.isPending}
          className="shrink-0"
        >
          {syncTracking.isPending ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Sync recruiter replies
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Discovered Jobs</CardTitle>
            <Radar className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.jobsDiscovered}</div>
            <p className="text-xs text-muted-foreground mt-1">+12% from last week</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Queued for Review</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.queued}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending approval</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Applications Sent</CardTitle>
            <Send className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.applied}</div>
            <p className="text-xs text-muted-foreground mt-1">Total dispatched</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Interviews Secured</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.interviews}</div>
            <p className="text-xs text-emerald-600 font-medium mt-1">{dashboard.responseRate.toFixed(1)}% hit rate</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Pipeline Area */}
        <div className="md:col-span-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Pipeline Funnel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {dashboard.pipeline.map((stage, idx) => {
                  const maxCount = Math.max(...dashboard.pipeline.map(s => s.count), 1);
                  const width = (stage.count / maxCount) * 100;
                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-foreground capitalize">{stage.status}</span>
                        <span className="text-muted-foreground font-mono">{stage.count}</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Batch Engine Status</CardTitle>
              <Badge variant={limitPercentage > 90 ? "destructive" : "default"}>
                {dashboard.dailyUsed} / {dashboard.dailyLimit} Daily
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Daily Quota</span>
                  <span className="font-medium">{limitPercentage.toFixed(0)}%</span>
                </div>
                <Progress value={limitPercentage} className="h-2" />
              </div>
              <div className="pt-2">
                <Link href="/batch" className="text-sm text-primary font-medium flex items-center gap-1 hover:underline">
                  Configure limits <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Activity Feed */}
        <div className="md:col-span-3">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-accent" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <div className="relative pl-4 space-y-6 before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-border">
                {activities?.map((item) => (
                  <div key={item.id} className="relative">
                    <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                    <div className="flex flex-col space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{item.title}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                          {formatDate(item.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                      {item.type === 'job_discovered' && (
                        <Badge variant="outline" className="w-fit mt-1 text-[10px]">New match</Badge>
                      )}
                      {item.type === 'application_sent' && (
                        <Badge variant="success" className="w-fit mt-1 text-[10px]">Sent</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {!activities?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent activity.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
