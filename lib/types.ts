export type Role = "teacher" | "student";
export type Channel = "telegram" | "max";
export type LessonStatus =
  "planned" | "completed" | "cancelled" | "rescheduled";
export interface Account {
  id: string;
  tutorId: string;
  studentId?: string;
  role: Role;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  paymentDetails: string;
  timezone: string;
  reportDays: number;
  legalAcceptance?: {
    termsVersion: string;
    termsAt: string;
    personalDataVersion: string;
    personalDataAt: string;
  };
}
export interface Student {
  id: string;
  tutorId: string;
  name: string;
  email: string;
  subject: string;
  grade: string;
  billing: "lesson" | "package";
  rate: number;
  packageSize: number;
  initialBalance: number;
  parentCode: string;
  note: string;
  createdAt: string;
}
export interface Group {
  id: string;
  tutorId: string;
  name: string;
  studentIds: string[];
}
export interface Lesson {
  id: string;
  tutorId: string;
  title: string;
  subject: string;
  studentIds: string[];
  start: string;
  duration: number;
  status: LessonStatus;
  location: string;
  seriesId?: string;
  originalStart?: string;
  attendance: Record<string, boolean>;
  rates: Record<string, number>;
}
export interface Assignment {
  id: string;
  tutorId: string;
  title: string;
  subject: string;
  text: string;
  links: string[];
  fileIds: string[];
  studentIds: string[];
  deadline: string;
  maxScore: number;
  archived: boolean;
  createdAt: string;
}
export interface Submission {
  id: string;
  tutorId: string;
  assignmentId: string;
  studentId: string;
  text: string;
  fileIds: string[];
  status: "submitted" | "revision" | "reviewed";
  score?: number;
  comment: string;
  createdAt: string;
  reviewedAt?: string;
}
export interface Payment {
  id: string;
  tutorId: string;
  studentId: string;
  amount: number;
  lessons: number;
  lessonIds: string[];
  note: string;
  createdAt: string;
}
export interface StoredFile {
  id: string;
  tutorId: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  key: string;
  createdAt: string;
  pending?: boolean;
}
export interface Invite {
  id: string;
  tutorId: string;
  studentId: string;
  tokenHash: string;
  expiresAt: string;
  used: boolean;
}
export interface Session {
  id: string;
  tutorId: string;
  accountId: string;
  expiresAt: string;
}
export interface Binding {
  id: string;
  tutorId: string;
  studentId: string;
  role: "student" | "parent";
  channel: Channel;
  chatId: string;
  userId: string;
  createdAt: string;
}
export interface LinkToken {
  id: string;
  tutorId: string;
  studentId: string;
  tokenHash: string;
  expiresAt: string;
  channel: Channel;
}
export interface Report {
  id: string;
  tutorId: string;
  studentId: string;
  from: string;
  to: string;
  text: string;
  status: "pending" | "ready" | "failed";
  error?: string;
  createdAt: string;
}
export interface Job {
  id: string;
  tutorId: string;
  kind: "message" | "report" | "bot";
  status: "pending" | "processing" | "done" | "failed";
  bindingId?: string;
  reportId?: string;
  channel?: Channel;
  chatId?: string;
  text?: string;
  buttons?: { text: string; data: string }[];
  attachments?: { type: string; token: string }[];
  event?: unknown;
  attempts: number;
  nextAt: string;
  leaseAt?: string;
  error?: string;
  createdAt: string;
}
export interface BotFlow {
  id: string;
  tutorId: string;
  bindingId: string;
  assignmentId: string;
  fileIds: string[];
  text: string;
  expiresAt: string;
}
export interface Receipt {
  id: string;
  tutorId: string;
  expiresAt: string;
  telegramOffset?: number;
  telegramPolledAt?: string;
}
export interface RateLimit {
  id: string;
  tutorId: string;
  count: number;
  expiresAt: string;
}
export interface Subscription {
  id: string;
  tutorId: string;
  trialEndsAt: string;
  paidUntil?: string;
  freeAccess?: boolean;
  autoRenew: boolean;
  paymentMethodId?: string;
  consentAt?: string;
  consentVersion?: string;
  renewalVersion: number;
  failedAttempts: number;
  nextAttemptAt?: string;
  lastError?: string;
}
export interface SubscriptionPayment {
  id: string;
  tutorId: string;
  providerId?: string;
  status: "creating" | "pending" | "succeeded" | "canceled" | "review";
  kind: "checkout" | "renewal";
  amountKopecks: number;
  autoRenew: boolean;
  renewalVersion: number;
  request: Record<string, unknown>;
  confirmationUrl?: string;
  createdAt: string;
  firstSentAt?: string;
  checkedAt?: string;
  appliedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  error?: string;
}
export interface BillingEvent {
  id: string;
  tutorId: string;
  paymentId?: string;
  kind: string;
  createdAt: string;
  note?: string;
}
export interface SubscriptionView {
  status: "trial" | "active" | "grace" | "expired" | "free";
  canWrite: boolean;
  trialEndsAt: string;
  paidUntil?: string;
  accessUntil: string | null;
  autoRenew: boolean;
  nextAttemptAt?: string;
  lastError?: string;
  priceRub: number;
  configured: boolean;
}
export interface Database {
  accounts: Account[];
  students: Student[];
  groups: Group[];
  lessons: Lesson[];
  assignments: Assignment[];
  submissions: Submission[];
  payments: Payment[];
  files: StoredFile[];
  invites: Invite[];
  sessions: Session[];
  bindings: Binding[];
  linkTokens: LinkToken[];
  reports: Report[];
  jobs: Job[];
  flows: BotFlow[];
  receipts: Receipt[];
  limits: RateLimit[];
  subscriptions: Subscription[];
  subscriptionPayments: SubscriptionPayment[];
  billingEvents: BillingEvent[];
}
export type Collection = keyof Database;
export interface Snapshot {
  user: Omit<Account, "passwordHash">;
  students: Student[];
  groups: Group[];
  lessons: Lesson[];
  assignments: Assignment[];
  submissions: Submission[];
  payments: Payment[];
  files: Omit<StoredFile, "key">[];
  bindings: Omit<Binding, "chatId" | "userId">[];
  reports: Report[];
  jobs: Pick<Job, "id" | "kind" | "status" | "error" | "createdAt">[];
  demo: boolean;
  integrations: Record<string, boolean>;
  subscription: SubscriptionView;
}
