import * as React from "react"
import { useListJobs, useUpdateJob, useCreateJob, getListJobsQueryKey, type Job } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ExternalLink, Check, X, Building, MapPin, DollarSign, Target, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Jobs() {
  const [search, setSearch] = React.useState("");
  const [selectedJob, setSelectedJob] = React.useState<Job | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("new");
  const [intakeOpen, setIntakeOpen] = React.useState(false);
  const [intake, setIntake] = React.useState({
    company: "", title: "", location: "", workMode: "remote", salary: "",
    source: "manual", sourceUrl: "", description: "",
  });
  const [, setLocation] = useLocation();
  
  const queryClient = useQueryClient();
  const { data: jobs, isLoading } = useListJobs({ search, status: activeTab });
  const updateJob = useUpdateJob();
  const createJob = useCreateJob();

  const resetIntake = () => setIntake({
    company: "", title: "", location: "", workMode: "remote", salary: "",
    source: "manual", sourceUrl: "", description: "",
  });

  const handleCreateJob = () => {
    const required = ["company", "title", "location", "salary", "source", "description"] as const;
    if (required.some((field) => !intake[field].trim())) {
      toast.error("Add the company, role, location, salary, source, and job description.");
      return;
    }
    createJob.mutate({ data: intake }, {
      onSuccess: (job) => {
        toast.success("Job added to your queue");
        queryClient.invalidateQueries();
        setIntakeOpen(false);
        resetIntake();
        setActiveTab("new");
        setSelectedJob(job);
        setDialogOpen(true);
      },
      onError: () => toast.error("Could not add this job"),
    });
  };

  const handleStatusUpdate = (jobId: number, status: string) => {
    updateJob.mutate({ id: jobId, data: { status } }, {
      onSuccess: () => {
        toast.success(`Job marked as ${status}`);
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        setDialogOpen(false);
      },
      onError: () => {
        toast.error("Failed to update job status");
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Job Queue</h1>
          <p className="text-muted-foreground mt-1 text-sm">Review targeted matches and tailor your applications.</p>
        </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button onClick={() => setIntakeOpen(true)} className="shrink-0">
              <Plus className="w-4 h-4 mr-2" /> Add Job
            </Button>
            <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search roles, companies..." 
            className="pl-9 bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
            </div>
          </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full sm:w-auto grid grid-cols-2 mb-4">
          <TabsTrigger value="new">Discovery Queue</TabsTrigger>
          <TabsTrigger value="approved">Tailoring Queue</TabsTrigger>
        </TabsList>
        
        <TabsContent value={activeTab} className="mt-0">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-12 flex justify-center"><Loader /></div>
              ) : !jobs || jobs.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <Target className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>No {activeTab === "new" ? "new" : "approved"} jobs in the queue.</p>
                  {activeTab === "new" && (
                    <Button variant="outline" className="mt-5" onClick={() => setIntakeOpen(true)}>
                      <Plus className="w-4 h-4 mr-2" /> Add your first job
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Salary</TableHead>
                      <TableHead>Fit Score</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id} className="cursor-pointer group" onClick={() => { setSelectedJob(job); setDialogOpen(true); }}>
                        <TableCell className="font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            <Building className="w-4 h-4 text-muted-foreground" />
                            {job.company}
                          </div>
                        </TableCell>
                        <TableCell>{job.title}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <MapPin className="w-3.5 h-3.5" />
                            {job.location}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <DollarSign className="w-3.5 h-3.5" />
                            {job.salary}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={job.fitScore > 85 ? "success" : "secondary"}>
                            {job.fitScore}% Match
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                            {activeTab === "new" ? (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleStatusUpdate(job.id, "rejected")}>
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-primary hover:bg-primary/10" onClick={() => handleStatusUpdate(job.id, "approved")}>
                                  <Check className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" className="h-8" onClick={() => setLocation(`/jobs/${job.id}/tailoring`)}>
                                <FileText className="w-4 h-4 mr-2" />
                                Tailor
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {selectedJob && (
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex justify-between items-start">
                <div>
                  <DialogTitle className="text-2xl mb-1">{selectedJob.title}</DialogTitle>
                  <div className="flex items-center gap-3 text-muted-foreground text-sm font-medium">
                    <span className="flex items-center gap-1"><Building className="w-4 h-4" /> {selectedJob.company}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {selectedJob.location}</span>
                  </div>
                </div>
                <Badge variant="success" className="text-lg px-3 py-1">{selectedJob.fitScore}% Match</Badge>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-6 py-6 border-y my-4">
              <div className="col-span-2 space-y-4">
                <div>
                  <h4 className="font-serif font-bold text-sm uppercase tracking-wide text-muted-foreground mb-2">Description</h4>
                  <div className="text-sm leading-relaxed text-foreground prose prose-sm max-w-none dark:prose-invert">
                    {selectedJob.description}
                  </div>
                </div>
              </div>
              
              <div className="col-span-1 space-y-6">
                <div>
                  <h4 className="font-serif font-bold text-sm uppercase tracking-wide text-muted-foreground mb-2">Details</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between border-b pb-1">
                      <span className="text-muted-foreground">Work Mode</span>
                      <span className="font-medium capitalize">{selectedJob.workMode}</span>
                    </li>
                    <li className="flex justify-between border-b pb-1">
                      <span className="text-muted-foreground">Salary</span>
                      <span className="font-medium">{selectedJob.salary}</span>
                    </li>
                    <li className="flex justify-between border-b pb-1">
                      <span className="text-muted-foreground">Source</span>
                      <span className="font-medium capitalize">{selectedJob.source}</span>
                    </li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-serif font-bold text-sm uppercase tracking-wide text-muted-foreground mb-2">Matched Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedJob.matchedSkills.map((s: string) => (
                      <Badge key={s} variant="secondary" className="bg-primary/10 text-primary">{s}</Badge>
                    ))}
                  </div>
                </div>
                
                {selectedJob.missingSkills.length > 0 && (
                  <div>
                    <h4 className="font-serif font-bold text-sm uppercase tracking-wide text-muted-foreground mb-2">Missing Skills</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedJob.missingSkills.map((s: string) => (
                        <Badge key={s} variant="outline" className="border-destructive/30 text-destructive/80">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="flex justify-between sm:justify-between items-center w-full">
              {selectedJob.sourceUrl ? (
                <a href={selectedJob.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-primary flex items-center gap-1 hover:underline">
                  View Original Listing <ExternalLink className="w-3 h-3" />
                </a>
              ) : <div />}
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setLocation(`/jobs/${selectedJob.id}/tailoring`)}>
                  <FileText className="w-4 h-4 mr-2" />
                  Tailor now
                </Button>
                {activeTab === "new" ? (
                  <>
                    <Button variant="outline" className="border-destructive/20 text-destructive hover:bg-destructive/10" 
                      onClick={() => handleStatusUpdate(selectedJob.id, "rejected")} disabled={updateJob.isPending}>
                      Reject Fit
                    </Button>
                    <Button onClick={() => handleStatusUpdate(selectedJob.id, "approved")} disabled={updateJob.isPending}>
                      Approve for Application
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setLocation(`/jobs/${selectedJob.id}/tailoring`)}>
                    Tailor Application
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif">Add a job</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Paste a listing to add it to your private queue, then tailor it against your verified profile evidence.
            </p>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            {([
              ["company", "Company", "e.g. Linear"],
              ["title", "Role", "e.g. Senior Product Engineer"],
              ["location", "Location", "e.g. Cairo or Remote"],
              ["salary", "Salary", "e.g. $120k–$150k"],
              ["source", "Source", "e.g. LinkedIn"],
              ["workMode", "Work mode", "remote, hybrid, or onsite"],
              ["sourceUrl", "Listing URL", "https://..."],
            ] as const).map(([field, label, placeholder]) => (
              <div key={field} className="space-y-1.5">
                <label className="text-sm font-medium">{label}{["company", "title", "location", "salary", "source"].includes(field) && " *"}</label>
                <Input
                  value={intake[field]}
                  placeholder={placeholder}
                  onChange={(event) => setIntake((current) => ({ ...current, [field]: event.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">Job description *</label>
              <Textarea
                value={intake.description}
                placeholder="Paste the complete job description here..."
                rows={8}
                onChange={(event) => setIntake((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIntakeOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateJob} disabled={createJob.isPending}>
              {createJob.isPending ? "Adding..." : "Add to queue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}