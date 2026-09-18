import * as React from "react"
import { useGetBatchSettings, useUpdateBatchSettings, getGetBatchSettingsQueryKey, useStartBatchRun, useListJobs, type BatchSettings as BatchSettingsType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/loader";
import { toast } from "sonner";
import { Zap, ShieldAlert, Rocket, Settings, AlertTriangle } from "lucide-react";

export default function BatchSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetBatchSettings();
  const { data: jobs } = useListJobs();
  const updateSettings = useUpdateBatchSettings();
  const startBatchRun = useStartBatchRun();
  
  // Local state for optimistic updates / form binding
  const [localSettings, setLocalSettings] = React.useState<BatchSettingsType | null>(null);
  
  const initializedForId = React.useRef(false);

  React.useEffect(() => {
    if (settings && !initializedForId.current) {
      setLocalSettings(settings);
      initializedForId.current = true;
    }
  }, [settings]);

  const handleSave = () => {
    if (!localSettings) return;
    updateSettings.mutate({ data: localSettings }, {
      onSuccess: (data) => {
        toast.success("Batch configuration updated");
        queryClient.setQueryData(getGetBatchSettingsQueryKey(), data);
      },
      onError: () => toast.error("Failed to update configuration")
    });
  };

  const handleStartRun = () => {
    if (!localSettings?.enabled) {
      toast.error("Enable batch mode before starting a run");
      return;
    }
    const jobIds = (jobs ?? [])
      .filter((job) => job.fitScore >= localSettings.minimumFitScore)
      .map((job) => job.id);
    if (!jobIds.length) {
      toast.error("No jobs meet the current fit threshold");
      return;
    }
    startBatchRun.mutate({ data: { jobIds } }, {
      onSuccess: (run) => toast.success("Batch run started", {
        description: `${run.queuedCount} applications entered the controlled queue.`
      }),
      onError: () => toast.error("Could not start the batch run")
    });
  };

  if (isLoading || !localSettings) return <Loader />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Batch Engine</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure and execute automated mass applications safely.</p>
        </div>
        <Button size="lg" className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90" onClick={handleStartRun}>
          <Rocket className="w-5 h-5" /> Execute Batch Run
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Settings className="h-5 w-5 text-primary" />
              Engine Constraints
            </CardTitle>
            <CardDescription>Rules to govern how fast and selectively applications are dispatched.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold">Enable Automation Engine</Label>
                <p className="text-sm text-muted-foreground">Master switch for background application dispatch.</p>
              </div>
              <Switch 
                checked={localSettings.enabled} 
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, enabled: v })}
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Daily Limit (Applications)</Label>
                <Input 
                  type="number" 
                  value={localSettings.dailyLimit} 
                  onChange={(e) => setLocalSettings({ ...localSettings, dailyLimit: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Maximum submissions per day to avoid spam blocks.</p>
              </div>
              <div className="space-y-2">
                <Label>Delay Between Runs (Minutes)</Label>
                <Input 
                  type="number" 
                  value={localSettings.delayMinutes} 
                  onChange={(e) => setLocalSettings({ ...localSettings, delayMinutes: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Throttle rate to mimic human behavior.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Minimum Fit Score Trigger</Label>
              <div className="flex items-center gap-4">
                <Input 
                  type="number" 
                  className="w-24"
                  value={localSettings.minimumFitScore} 
                  onChange={(e) => setLocalSettings({ ...localSettings, minimumFitScore: Number(e.target.value) })}
                />
                <span className="text-sm font-medium text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Auto-approve jobs with a match score above this threshold.</p>
            </div>
          </CardContent>
          <CardFooter className="bg-muted/10 border-t pt-4">
            <Button onClick={handleSave} disabled={updateSettings.isPending} className="ml-auto">
              Save Configuration
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-destructive/20 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-destructive text-lg">
              <ShieldAlert className="h-5 w-5" />
              Safety Protocols
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start gap-3 space-y-0">
              <Switch 
                checked={localSettings.requireReviewForSensitive} 
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, requireReviewForSensitive: v })}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label className="font-semibold leading-tight block">Require Human Review</Label>
                <p className="text-xs text-muted-foreground">Pause execution when forms require custom text answers or specific checkboxes.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 space-y-0">
              <Switch 
                checked={localSettings.stopOnCaptcha} 
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, stopOnCaptcha: v })}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label className="font-semibold leading-tight block">Halt on CAPTCHA</Label>
                <p className="text-xs text-muted-foreground">Immediately stop the queue when a CAPTCHA is detected.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 space-y-0">
              <Switch 
                checked={localSettings.stopOnMfa} 
                onCheckedChange={(v) => setLocalSettings({ ...localSettings, stopOnMfa: v })}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label className="font-semibold leading-tight block">Halt on MFA</Label>
                <p className="text-xs text-muted-foreground">Stop if the portal prompts for multi-factor authentication.</p>
              </div>
            </div>

            <div className="mt-6 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 font-medium">Warning: Disabling safety protocols increases the risk of account suspensions on major job boards.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
