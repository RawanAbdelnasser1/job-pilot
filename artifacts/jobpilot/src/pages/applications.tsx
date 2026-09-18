import * as React from "react"
import {
  useListApplications,
  useUpdateApplication,
  usePrepareApplicationExecution,
  useSubmitApplicationExecution,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building, ExternalLink, CalendarClock, AlertCircle, Play, Send, ShieldAlert, Mail } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

export default function Applications() {
  const queryClient = useQueryClient();
  const { data: applications, isLoading } = useListApplications();
  const updateApp = useUpdateApplication();
  const prepareExecution = usePrepareApplicationExecution();
  const submitExecution = useSubmitApplicationExecution();
  const [approvalTokens, setApprovalTokens] = React.useState<Record<number, string>>({});

  const handleStatusChange = (id: number, newStatus: string) => {
    updateApp.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        toast.success(`Application updated to ${newStatus}`);
        queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      },
      onError: () => toast.error("Failed to update application")
    });
  };

  const handlePrepareExecution = (id: number, submitAutomatically = false) => {
    prepareExecution.mutate(
      { id, data: { submitAutomatically } },
      {
        onSuccess: (result) => {
          if (result.approvalToken) {
            setApprovalTokens((tokens) => ({ ...tokens, [id]: result.approvalToken! }));
          }
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
          if (result.executionState === "blocked") {
            toast.error(result.events.at(-1)?.message ?? "Application needs manual review");
          } else if (result.executionState === "submitted") {
            toast.success("Application submitted");
          } else {
            toast.success("Form prepared. Review it before submitting.");
          }
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not prepare application"),
      },
    );
  };

  const handleSubmitExecution = (id: number) => {
    const approvalToken = approvalTokens[id];
    if (!approvalToken) {
      toast.error("This review session expired. Prepare the form again.");
      return;
    }
    submitExecution.mutate(
      { id, data: { approvalToken } },
      {
        onSuccess: () => {
          setApprovalTokens((tokens) => {
            const next = { ...tokens };
            delete next[id];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
          toast.success("Application submitted");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not submit application"),
      },
    );
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'applied': return 'default';
      case 'interviewing': return 'warning';
      case 'interview': return 'warning';
      case 'offered': return 'success';
      case 'offer': return 'success';
      case 'assessment': return 'secondary';
      case 'responded': return 'secondary';
      case 'rejected': return 'destructive';
      case 'review': return 'secondary';
      case 'queued': return 'outline';
      case 'blocked': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Active Pipeline</h1>
        <p className="text-muted-foreground mt-1 text-sm">Track your progress and manage ongoing interviews.</p>
      </div>

      {isLoading ? (
        <Loader />
      ) : !applications || applications.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <CalendarClock className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-serif font-semibold">No Active Applications</h3>
            <p className="text-muted-foreground text-sm max-w-sm mt-1">
              Approve jobs from the discovery queue or start a batch run to populate your pipeline.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {applications.map((app) => (
            <Card key={app.id} className="flex flex-col relative overflow-hidden transition-all hover:shadow-md border-border">
              {app.blocker && (
                <div className="absolute top-0 inset-x-0 h-1 bg-destructive" />
              )}
              <CardHeader className="pb-3 pt-5">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant={getStatusColor(app.status)} className="capitalize px-2 py-0.5 shadow-none font-medium">
                    {app.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{formatDate(app.updatedAt)}</span>
                </div>
                <CardTitle className="text-lg leading-tight">{app.title}</CardTitle>
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mt-1">
                  <Building className="w-3.5 h-3.5" />
                  {app.company}
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 flex flex-col justify-end space-y-4">
                {app.blocker && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-2 rounded-md flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{app.blocker}</span>
                  </div>
                )}

                <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Portal execution</span>
                    <span className="font-medium capitalize">{app.portalType || "detecting"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {app.requiresUserAction ? <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> : <Play className="h-3.5 w-3.5" />}
                    <span className="capitalize">{app.currentStep?.replaceAll("_", " ") || "queued"}</span>
                  </div>
                </div>

                {app.lastReplyAt && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <Mail className="h-3.5 w-3.5 text-primary" />
                      Latest recruiter signal
                      <Badge variant="outline" className="ml-auto capitalize text-[10px]">
                        {app.lastReplyType}
                      </Badge>
                    </div>
                    <p className="text-xs font-medium line-clamp-1">{app.lastReplySubject}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(app.lastReplyAt)}</p>
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-muted-foreground">Progress</span>
                    <span>{app.progress}%</span>
                  </div>
                  <Progress value={app.progress} className="h-1.5" />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <Select 
                    defaultValue={app.status} 
                    onValueChange={(val) => handleStatusChange(app.id, val)}
                    disabled={updateApp.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                     <SelectItem value="queued">Queued</SelectItem>
                     <SelectItem value="preparing">Preparing</SelectItem>
                     <SelectItem value="review">Ready for review</SelectItem>
                      <SelectItem value="applied">Applied</SelectItem>
                       <SelectItem value="responded">Responded</SelectItem>
                       <SelectItem value="assessment">Assessment</SelectItem>
                       <SelectItem value="interview">Interview</SelectItem>
                      <SelectItem value="interviewing">Interviewing</SelectItem>
                       <SelectItem value="offer">Offer</SelectItem>
                      <SelectItem value="offered">Offered</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>

                  {app.executionState === "ready_for_submit" && approvalTokens[app.id] ? (
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => handleSubmitExecution(app.id)}
                      disabled={submitExecution.isPending}
                    >
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Submit
                    </Button>
                  ) : !["submitted", "applied"].includes(app.executionState) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8"
                      onClick={() => handlePrepareExecution(app.id)}
                      disabled={prepareExecution.isPending}
                    >
                      <Play className="w-3.5 h-3.5 mr-1.5" /> Prepare form
                    </Button>
                  ) : null}
                  
                  {app.portalUrl && (
                    <Button variant="outline" size="sm" className="h-8 px-2" asChild>
                      <a href={app.portalUrl} target="_blank" rel="noreferrer" title="Open Portal">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
