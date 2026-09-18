import * as React from "react"
import { useGetProfile, useUpdateProfile, getGetProfileQueryKey, type EvidenceItem, EvidenceItemCategory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { User, Target, Award, Plus, Trash2, ShieldCheck, Briefcase, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const profileSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters."),
  email: z.string().email("Invalid email address."),
  phone: z.string().optional(),
  location: z.string().optional(),
  headline: z.string().optional(),
  targetRoles: z.string().min(1, "Target roles required"), 
  preferredLocations: z.string().min(1, "Preferred locations required"),
  workModes: z.string(),
  minimumSalary: z.coerce.number().min(0, "Must be positive"),
  skills: z.string(),
  evidence: z.array(z.object({
    id: z.string(),
    category: z.nativeEnum(EvidenceItemCategory),
    title: z.string().min(1, "Required"),
    organization: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    detail: z.string().min(1, "Required"),
    source: z.string().min(1, "Required"),
  })).default([]),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function Profile() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetProfile();
  const updateProfile = useUpdateProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      location: "",
      headline: "",
      targetRoles: "",
      preferredLocations: "",
      workModes: "",
      minimumSalary: 0,
      skills: "",
      evidence: [],
    },
  });

  const { fields: evidenceFields, append: appendEvidence, remove: removeEvidence } = useFieldArray({
    control: form.control,
    name: "evidence",
  });

  const initializedForId = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (profile && initializedForId.current !== profile.id) {
      initializedForId.current = profile.id;
      form.reset({
        fullName: profile.fullName || "",
        email: profile.email || "",
        phone: profile.phone || "",
        location: profile.location || "",
        headline: profile.headline || "",
        targetRoles: profile.targetRoles?.join(", ") || "",
        preferredLocations: profile.preferredLocations?.join(", ") || "",
        workModes: profile.workModes?.join(", ") || "",
        minimumSalary: profile.minimumSalary || 0,
        skills: profile.skills?.join(", ") || "",
        evidence: profile.evidence || [],
      });
    }
  }, [profile, form]);

  const onSubmit = (values: ProfileFormValues) => {
    const formattedData = {
      ...values,
      targetRoles: values.targetRoles.split(",").map(s => s.trim()).filter(Boolean),
      preferredLocations: values.preferredLocations.split(",").map(s => s.trim()).filter(Boolean),
      workModes: values.workModes.split(",").map(s => s.trim()).filter(Boolean),
      skills: values.skills.split(",").map(s => s.trim()).filter(Boolean),
    };

    updateProfile.mutate({ data: formattedData }, {
      onSuccess: (data) => {
        toast.success("Profile updated successfully");
        queryClient.setQueryData(getGetProfileQueryKey(), data);
      },
      onError: () => toast.error("Failed to update profile")
    });
  };

  if (isLoading) return <Loader />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Pilot Profile</h1>
          <p className="text-muted-foreground mt-1 text-sm">Your primary payload. The better this is tuned, the better your match rate.</p>
        </div>
        
        {profile && (
          <div className="w-full sm:w-64 bg-card border rounded-lg p-3 shadow-sm">
            <div className="flex justify-between text-xs font-semibold mb-1">
              <span className="text-muted-foreground uppercase tracking-wider">Profile Completeness</span>
              <span className="text-primary">{profile.completion}%</span>
            </div>
            <Progress value={profile.completion} className="h-1.5" />
          </div>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5 text-primary" />
                Personal Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-6">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Location</FormLabel>
                  <FormControl><Input {...field} placeholder="City, State" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="headline" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Professional Headline</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Senior Frontend Engineer specializing in React" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                Target Parameters
              </CardTitle>
              <CardDescription>Comma-separated lists for the matching algorithm.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-6">
              <FormField control={form.control} name="targetRoles" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Target Roles</FormLabel>
                  <FormControl><Input {...field} placeholder="Frontend Engineer, UI Developer" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="preferredLocations" render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred Locations</FormLabel>
                  <FormControl><Input {...field} placeholder="Remote, San Francisco, NY" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="workModes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Work Modes</FormLabel>
                  <FormControl><Input {...field} placeholder="Remote, Hybrid, On-site" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="minimumSalary" render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum Salary (USD)</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="skills" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Core Skills</FormLabel>
                  <FormControl><Input {...field} placeholder="React, TypeScript, Node.js" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Award className="h-5 w-5 text-primary" />
                  Structured Evidence
                </CardTitle>
                <CardDescription>Ground truth for the AI. Generates your tailored CV and cover letters.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => appendEvidence({
                id: crypto.randomUUID(),
                category: EvidenceItemCategory.experience,
                title: "",
                organization: "",
                detail: "",
                source: "",
                startDate: "",
                endDate: ""
              })}>
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {evidenceFields.length === 0 ? (
                <div className="text-center py-10 border border-dashed rounded-lg bg-muted/30">
                  <ShieldCheck className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-50" />
                  <h3 className="font-medium">No evidence added</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                    Add work experience, projects, or education to allow the AI to construct factual application materials.
                  </p>
                </div>
              ) : (
                evidenceFields.map((field, index) => (
                  <div key={field.id} className="p-5 border rounded-lg bg-card shadow-sm space-y-4 relative group">
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10"
                      onClick={() => removeEvidence(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mr-6">
                      <FormField control={form.control} name={`evidence.${index}.category`} render={({ field: catField }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground uppercase">Category</FormLabel>
                          <Select onValueChange={catField.onChange} defaultValue={catField.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(EvidenceItemCategory).map(cat => (
                                <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      
                      <FormField control={form.control} name={`evidence.${index}.title`} render={({ field: titleField }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel className="text-xs text-muted-foreground uppercase">Title / Role</FormLabel>
                          <FormControl><Input {...titleField} placeholder="e.g. Senior Developer" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      
                      <FormField control={form.control} name={`evidence.${index}.organization`} render={({ field: orgField }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground uppercase">Organization</FormLabel>
                          <FormControl><Input {...orgField} placeholder="Company or Institution" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name={`evidence.${index}.startDate`} render={({ field: dateField }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground uppercase">Start Date</FormLabel>
                          <FormControl><Input {...dateField} placeholder="YYYY-MM" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name={`evidence.${index}.endDate`} render={({ field: dateField }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground uppercase">End Date</FormLabel>
                          <FormControl><Input {...dateField} placeholder="YYYY-MM or Present" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name={`evidence.${index}.detail`} render={({ field: detailField }) => (
                        <FormItem className="md:col-span-3">
                          <FormLabel className="text-xs text-muted-foreground uppercase">Details & Achievements</FormLabel>
                          <FormControl>
                            <Textarea {...detailField} placeholder="Describe responsibilities, metrics, and accomplishments..." className="resize-y min-h-[100px]" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name={`evidence.${index}.source`} render={({ field: sourceField }) => (
                        <FormItem className="md:col-span-3">
                          <FormLabel className="text-xs text-muted-foreground uppercase">Source Context</FormLabel>
                          <FormControl><Input {...sourceField} placeholder="Where is this verified? (e.g. LinkedIn, GitHub, Internal)" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end pt-4">
            <Button type="submit" size="lg" disabled={updateProfile.isPending} className="w-full sm:w-auto">
              {updateProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Configuration
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}