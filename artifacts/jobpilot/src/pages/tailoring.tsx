import * as React from "react";
import { useParams, Link } from "wouter";
import { 
  useGetJob, 
  useListJobGenerations, 
  useGenerateJobDocuments, 
  useUpdateGeneration,
  getListJobGenerationsQueryKey,
  type Generation
} from "@workspace/api-client-react";
import { downloadGenerationCv, downloadGenerationCoverLetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader } from "@/components/ui/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Download, Check, AlertCircle, History, Edit3, Save, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export default function Tailoring() {
  const params = useParams();
  const jobId = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();

  const { data: job, isLoading: jobLoading } = useGetJob(jobId, { query: { enabled: !!jobId, queryKey: ['job', jobId] } });
  const { data: generations, isLoading: genLoading } = useListJobGenerations(jobId, { query: { enabled: !!jobId, queryKey: getListJobGenerationsQueryKey(jobId) } });
  
  const generateDocs = useGenerateJobDocuments();
  const updateGeneration = useUpdateGeneration();

  const [activeGenId, setActiveGenId] = React.useState<number | null>(null);
  const [instructions, setInstructions] = React.useState("");
  
  // Local edit state for the active generation
  const [draftCv, setDraftCv] = React.useState("");
  const [draftCoverLetter, setDraftCoverLetter] = React.useState("");
  const [isEditing, setIsEditing] = React.useState(false);

  // Sync state when generations load or active generation changes
  React.useEffect(() => {
    if (generations && generations.length > 0) {
      if (!activeGenId) {
        // Default to the latest version
        const latest = [...generations].sort((a, b) => b.version - a.version)[0];
        setActiveGenId(latest.id);
      }
    }
  }, [generations, activeGenId]);

  const activeGen = React.useMemo(() => {
    return generations?.find(g => g.id === activeGenId) || null;
  }, [generations, activeGenId]);

  React.useEffect(() => {
    if (activeGen && !isEditing) {
      setDraftCv(activeGen.cvMarkdown);
      setDraftCoverLetter(activeGen.coverLetterMarkdown);
    }
  }, [activeGen, isEditing]);

  const handleGenerate = () => {
    generateDocs.mutate({ id: jobId, data: { instructions } }, {
      onSuccess: (newGen) => {
        toast.success("Generation started successfully");
        setInstructions("");
        setActiveGenId(newGen.id);
        queryClient.invalidateQueries({ queryKey: getListJobGenerationsQueryKey(jobId) });
      },
      onError: () => {
        toast.error("Failed to generate documents");
      }
    });
  };

  const handleSaveDraft = () => {
    if (!activeGen) return;
    updateGeneration.mutate({ id: activeGen.id, data: { cvMarkdown: draftCv, coverLetterMarkdown: draftCoverLetter } }, {
      onSuccess: (newRevision) => {
        toast.success("Draft saved. Regenerate it before approval to verify every claim.");
        setActiveGenId(newRevision.id);
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getListJobGenerationsQueryKey(jobId) });
      },
      onError: () => {
        toast.error("Failed to save draft");
      }
    });
  };

  const handleApprove = () => {
    if (!activeGen) return;
    updateGeneration.mutate({ id: activeGen.id, data: { status: "approved" } }, {
      onSuccess: (newRevision) => {
        toast.success("Generation approved and marked final");
        setActiveGenId(newRevision.id);
        queryClient.invalidateQueries({ queryKey: getListJobGenerationsQueryKey(jobId) });
      },
      onError: () => {
        toast.error("Failed to approve generation");
      }
    });
  };

  const onDownloadCv = async () => {
    if (!activeGen) return;
    try {
      const blob = await downloadGenerationCv(activeGen.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CV_Version_${activeGen.version}.docx`;
      a.click();
    } catch (e) {
      toast.error("Failed to download CV");
    }
  };

  const onDownloadCoverLetter = async () => {
    if (!activeGen) return;
    try {
      const blob = await downloadGenerationCoverLetter(activeGen.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CoverLetter_Version_${activeGen.version}.docx`;
      a.click();
    } catch (e) {
      toast.error("Failed to download Cover Letter");
    }
  };

  if (jobLoading || genLoading) {
    return <div className="p-12 flex justify-center"><Loader /></div>;
  }

  if (!job) {
    return <div className="p-12 text-center">Job not found.</div>;
  }

  const isApproved = activeGen?.status === "approved";

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-[1400px] mx-auto pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="rounded-full">
          <Link href="/jobs"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tailoring</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <span className="font-medium text-foreground">{job.company}</span>
            <span>&bull;</span>
            <span>{job.title}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {activeGen && (
            <Select 
              value={activeGenId?.toString()} 
              onValueChange={(val) => {
                setActiveGenId(parseInt(val, 10));
                setIsEditing(false);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <History className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {generations?.map(g => (
                  <SelectItem key={g.id} value={g.id.toString()}>
                    Version {g.version} {g.status === "approved" ? "(Final)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!generations || generations.length === 0 ? (
        <Card className="max-w-2xl mx-auto mt-12 border-dashed">
          <CardContent className="p-12 text-center space-y-6">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
              <FileText className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-semibold mb-2">Create Initial Draft</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Generate a tailored CV and Cover Letter for this role. JobPilot will automatically extract requirements and match them against your evidence.
              </p>
            </div>
            
            <div className="text-left space-y-2 mt-6">
              <label className="text-sm font-medium text-foreground">Special Instructions (Optional)</label>
              <Textarea 
                placeholder="e.g. Focus heavily on my leadership experience..." 
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
            
            <Button size="lg" className="w-full font-medium" onClick={handleGenerate} disabled={generateDocs.isPending}>
              {generateDocs.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FileText className="w-5 h-5 mr-2" />}
              Generate Documents
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 xl:col-span-9 space-y-6">
            {activeGen && (
              <Card className="border-t-4 border-t-primary shadow-sm h-full flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/20">
                  <div className="flex items-center gap-3">
                    <Badge variant={isApproved ? "success" : "secondary"} className="uppercase tracking-wider text-[10px] font-bold">
                      {activeGen.status}
                    </Badge>
                    <span className="text-sm font-mono text-muted-foreground">v{activeGen.version}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setIsEditing(false);
                          setDraftCv(activeGen.cvMarkdown);
                          setDraftCoverLetter(activeGen.coverLetterMarkdown);
                        }}>Cancel</Button>
                        <Button size="sm" onClick={handleSaveDraft} disabled={updateGeneration.isPending}>
                          <Save className="w-4 h-4 mr-2" /> Verify & Save
                        </Button>
                      </>
                    ) : (
                      <>
                        {!isApproved && (
                          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                            <Edit3 className="w-4 h-4 mr-2" /> Edit & Verify
                          </Button>
                        )}
                        {!isApproved && (
                          <Button size="sm" variant="default" onClick={handleApprove} disabled={updateGeneration.isPending}>
                            <Check className="w-4 h-4 mr-2" /> Approve Final
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <CardContent className="p-0 flex-1 flex flex-col">
                  <Tabs defaultValue="cv" className="w-full flex-1 flex flex-col">
                    <div className="px-6 border-b flex items-center justify-between">
                      <TabsList className="h-14 bg-transparent">
                        <TabsTrigger value="cv" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 font-medium">Curriculum Vitae</TabsTrigger>
                        <TabsTrigger value="cl" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-14 font-medium">Cover Letter</TabsTrigger>
                      </TabsList>
                      <div className="flex items-center gap-2">
                         <Button variant="ghost" size="sm" onClick={onDownloadCv} title="Download CV (DOCX)"><Download className="w-4 h-4 text-muted-foreground" /></Button>
                         <Button variant="ghost" size="sm" onClick={onDownloadCoverLetter} title="Download Cover Letter (DOCX)"><Download className="w-4 h-4 text-muted-foreground" /></Button>
                      </div>
                    </div>
                    <TabsContent value="cv" className="flex-1 p-0 m-0 min-h-[500px]">
                      {isEditing ? (
                        <Textarea 
                          value={draftCv} 
                          onChange={e => setDraftCv(e.target.value)}
                          className="min-h-[500px] h-full w-full border-0 focus-visible:ring-0 rounded-none font-mono text-sm p-6 resize-none bg-muted/10"
                        />
                      ) : (
                        <div className="p-8 prose prose-sm max-w-none dark:prose-invert font-sans whitespace-pre-wrap">
                          {activeGen.cvMarkdown || "No CV content."}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="cl" className="flex-1 p-0 m-0 min-h-[500px]">
                      {isEditing ? (
                        <Textarea 
                          value={draftCoverLetter} 
                          onChange={e => setDraftCoverLetter(e.target.value)}
                          className="min-h-[500px] h-full w-full border-0 focus-visible:ring-0 rounded-none font-mono text-sm p-6 resize-none bg-muted/10"
                        />
                      ) : (
                        <div className="p-8 prose prose-sm max-w-none dark:prose-invert font-sans whitespace-pre-wrap">
                          {activeGen.coverLetterMarkdown || "No cover letter content."}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </div>
          
          <div className="lg:col-span-4 xl:col-span-3 space-y-6">
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-serif font-bold uppercase tracking-wider text-muted-foreground">New Revision</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Tweaks & Instructions</label>
                  <Textarea 
                    placeholder="E.g. Make the cover letter more aggressive, focus on metrics..." 
                    value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    className="text-sm h-24 resize-none"
                  />
                </div>
                <Button className="w-full" variant="secondary" onClick={handleGenerate} disabled={generateDocs.isPending}>
                  {generateDocs.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Edit3 className="w-4 h-4 mr-2" />}
                  Generate v{generations.length + 1}
                </Button>
              </CardContent>
            </Card>

            {activeGen?.rejectedClaims && activeGen.rejectedClaims.length > 0 && (
              <Card className="border-destructive/20 bg-destructive/5">
                <CardHeader className="pb-3 border-b border-destructive/10">
                  <CardTitle className="text-sm font-serif font-bold uppercase tracking-wider text-destructive flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Dropped Claims
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-xs text-destructive/80 mb-3">
                    The AI refused to include these statements because they could not be substantiated by your profile evidence:
                  </p>
                  <ul className="space-y-2">
                    {activeGen.rejectedClaims.map((claim, i) => (
                      <li key={i} className="text-sm flex items-start gap-2 text-foreground">
                        <span className="text-destructive mt-1">&times;</span>
                        <span className="leading-tight">{claim}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {activeGen?.claims && activeGen.claims.length > 0 && (
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm font-serif font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Check className="w-4 h-4" /> Claim Sources
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground mb-3">
                    Every factual statement below is linked to one structured profile evidence item.
                  </p>
                  <div className="space-y-3">
                    {activeGen.claims.map((claim, index) => (
                      <div key={`${claim.section}-${index}`} className="rounded-md border bg-muted/20 p-3">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                          {claim.section.replace("_", " ")}
                        </div>
                        <p className="text-xs leading-relaxed">{claim.text}</p>
                        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                          Source: {claim.evidenceIds.join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-serif font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Info className="w-4 h-4" /> Generation Info
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Model Used</span>
                  <span className="text-sm font-mono">{activeGen?.model || 'gpt-4o'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Evidence Used</span>
                  <span className="text-sm">{activeGen?.evidenceIds?.length || 0} claims referenced</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}