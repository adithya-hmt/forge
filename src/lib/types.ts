// ─── Forge domain model ─────────────────────────────────────────────────────

export type Category =
  | "hackathon" | "internship" | "fellowship" | "grant"
  | "accelerator" | "competition" | "job";

export type VerifyStatus = "verified" | "conflicting" | "unverified" | "expired";
export type ProviderId = "official" | "aggregator" | "university" | "grants";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  trust: number;          // base confidence for claims from this provider
  docs: number;           // docs in corpus
  note: string;
}

export interface SourceDoc {
  id: string;
  provider: string;       // provider/adapter id; ProviderId constants are the synthetic set
  url: string;
  title: string;
  text: string;
  retrievedAt: number;
  org?: string;           // organizer when the source page states it (dedupe signal)
  failFirst?: boolean;    // simulate transient fetch failure (retry path)
}

export interface EvidenceRef {
  sourceId: string;
  url: string;
  title: string;
  excerpt: string;
  retrievedAt: number;
  contentHash: string;
  provider: string;
  confidence: number;
}

export interface FieldClaim {
  value: string;
  status: VerifyStatus;
  evidence: EvidenceRef[];
  note?: string;
}

export interface OpportunityRequirement {
  id: string;
  label: string;
  skillKey?: string;      // maps into evidence graph
  kind: "skill" | "experience" | "status" | "artifact";
  weight: number;         // 1..3
}

export interface OpportunityChange {
  epoch: number;
  at: number;
  field: string;
  from: string;
  to: string;
  kind: "deadline" | "prize" | "status" | "eligibility" | "content";
}

export interface Opportunity {
  id: string;
  title: string;
  org: string;
  category: Category;
  url: string;
  location: string;
  remote: "remote" | "hybrid" | "onsite" | "unknown";
  deadline: FieldClaim | null;   // null ⇒ deadline not found (never fabricated)
  deadlineTs: number | null;     // conservative parse (earliest of conflicting)
  prize: FieldClaim | null;
  prizeValue: number | null;     // conservative numeric estimate
  eligibility: FieldClaim | null;
  status: VerifyStatus;
  skills: string[];              // skill keys
  requirements: OpportunityRequirement[];
  applicationRequirements: string[];
  competition: { level: "low" | "medium" | "high" | "unknown"; note: string };
  mergedFrom: string[];
  changeHistory: OpportunityChange[];
  firstSeenEpoch: number;
}

export type Stage =
  | "DISCOVER" | "FETCH" | "EXTRACT" | "NORMALIZE"
  | "DEDUPLICATE" | "VERIFY" | "STORE" | "MATCH";

export interface JobStep {
  stage: Stage;
  at: number;
  ms: number;
  detail: string;
  kind: "info" | "ok" | "warn" | "error";
}

export interface ResearchJob {
  id: string;
  goal: string;
  startedAt: number;
  finishedAt: number | null;
  steps: JobStep[];
  queries: string[];
  stages: Record<Stage, "pending" | "running" | "done" | "error">;
  resultIds: string[];
  costUsd: number;
  status: "running" | "done" | "error";
  injectedCount: number;
}

// ─── Evidence graph ─────────────────────────────────────────────────────────

export interface SkillNode {
  id: string;
  label: string;
  confidence: number;      // 0..1 evidence-backed confidence
  source: "github" | "resume" | "manual";
  corrected?: boolean;
}

export interface ProjectNode {
  id: string;
  name: string;
  repoUrl?: string;
  description: string;
  loc: number;
  lastActive: string;      // ISO
  substance: number;       // 0..1 (size + tests + CI + deploy)
  languages: { lang: string; pct: number }[];
  frameworks: string[];
  hasTests: boolean;
  hasCI: boolean;
  deployed: boolean;
  source: "github" | "resume";
}

export interface AchievementNode { id: string; label: string; detail: string; }

export interface EvidenceGraph {
  skills: SkillNode[];
  projects: ProjectNode[];
  achievements: AchievementNode[];
}

export interface ProofItem {
  via: string;             // artifact name
  detail: string;
  confidence: number;
  artifactId: string;
}

export interface ProofRow {
  requirement: OpportunityRequirement;
  evidence: ProofItem[];
  strength: "strong" | "medium" | "weak" | "none";
  gap: string | null;
}

export type GapType = "build" | "learn" | "document" | "contact" | "apply";

export interface GapAction {
  id: string;
  type: GapType;
  title: string;
  rationale: string;
  effortHours: [number, number];
  impact: number;          // 0..100
  produces: string[];
  forRequirement: string;
}

// ─── Fit engine ─────────────────────────────────────────────────────────────

export type FitDim =
  | "eligibility" | "skill" | "evidence" | "deadline"
  | "strategic" | "logistics" | "competition" | "preference";

export interface FitComponent {
  key: FitDim;
  label: string;
  score: number;           // 0..100
  weight: number;
  why: string;
}

export interface FitBreakdown {
  dims: FitComponent[];
  fit: number;
  confidence: number;      // 0..100
  expectedValue: number;   // comparable scalar
  evLabel: string;
}

export interface Match {
  oppId: string;
  breakdown: FitBreakdown;
  rank: number;
  proofs: ProofRow[];
  gaps: GapAction[];
}

// ─── Execution ──────────────────────────────────────────────────────────────

export interface PlanTask {
  id: string;
  title: string;
  rationale: string;
  due: number;             // ts
  kind: "research" | "build" | "write" | "review" | "submit" | "gap";
  done: boolean;
  estHours: number;
  dependsOn: string[];
}

export interface CalendarBlock {
  id: string;
  title: string;
  start: number;
  end: number;
  taskId?: string;
  externalId?: string;
}

export interface Plan {
  oppId: string;
  createdAt: number;
  deadline: number | null;
  milestones: { label: string; at: number }[];
  tasks: PlanTask[];
  docs: string[];
  contacts: string[];
  checklist: { label: string; done: boolean }[];
  calendar: CalendarBlock[];
  calendarSynced: boolean;
}

export type Outcome =
  | "ignored" | "saved" | "applied" | "interview"
  | "finalist" | "won" | "rejected" | "withdrawn";

export interface Application {
  oppId: string;
  status: Outcome;
  updatedAt: number;
  drafts: { kind: string; body: string; model: string; at: number }[];
}

export interface LearnedAdjustment {
  key: string;
  label: string;
  delta: number;           // points added to preference dim
  reason: string;
}

export interface Notification {
  id: string;
  at: number;
  kind: "change" | "deadline" | "gap" | "system";
  msg: string;
  oppId?: string;
  read: boolean;
}

export interface EmailMsg {
  id: string;
  from: string;
  subject: string;
  body: string;
  at: number;
  oppId?: string;
  detectedDeadline?: number;
  synthetic: boolean;
  externalId?: string;   // real Gmail message id when fetched via the server proxy
}

export interface EmailDraft {
  id: string;
  oppId?: string;
  to: string;
  subject: string;
  body: string;
  at: number;
  state: "draft" | "confirmed";
}

export interface RepoAnalysis {
  name: string;
  url: string;
  description: string;
  languages: { lang: string; bytes: number }[];
  sizeKb: number;
  pushedAt: number;
  stars: number;
  topics: string[];
  frameworks: string[];
  hasCI: boolean;
  hasTests: boolean;
  deployed: boolean;
  substance: number;
}

export interface GitHubReport {
  login: string;
  name: string;
  repos: RepoAnalysis[];
  analyzedAt: number;
  live: boolean;           // false ⇒ labeled synthetic sample
}

export interface ResumeExtraction {
  education: string[];
  skills: string[];
  experience: string[];
  projects: string[];
  achievements: string[];
  approved: boolean;
}

export interface Profile {
  name: string;
  level: string;
  location: string;
  remoteOnly: boolean;
  hoursPerWeek: number;
  categories: Category[];
  windowDays: number;
}

export interface Toast { id: number; msg: string; kind: "ok" | "warn" | "error" | "info"; }

export type View =
  | { name: "command" } | { name: "radar" } | { name: "search" }
  | { name: "evidence" } | { name: "jobs" } | { name: "settings" }
  | { name: "opportunity"; id: string }
  | { name: "workspace"; oppId: string };
