import { z } from "zod"
import { JsonValueSchema } from "../shared/json"

export const IdentityProfileSchema = z.enum(["current", "management"])
export const RecordFamilySchema = z.enum(["customer", "vendor", "employee", "item", "transaction"])

export const IdentityProfileInputSchema = z.object({
  profile: IdentityProfileSchema.default("current"),
})

export const DiagnoseAuthenticationInputSchema = IdentityProfileInputSchema.extend({
  includeAuthenticatedChecks: z.boolean().default(true),
})

export const LoginAuditTrailInputSchema = IdentityProfileInputSchema.extend({
  status: z.enum(["success", "failure", "either"]).default("either"),
  userId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

export const RoleAccessInputSchema = IdentityProfileInputSchema.extend({
  recordFamilies: z.array(RecordFamilySchema).min(1).max(10),
  permissions: z.array(z.string().min(1)).max(50).default([]),
})

export const RoleComparisonInputSchema = z.object({
  recordFamilies: z.array(RecordFamilySchema).min(1).max(10),
  permissions: z.array(z.string().min(1)).max(50).default([]),
})

export const IntegrationStateInputSchema = IdentityProfileInputSchema.extend({
  integrationId: z.union([z.string().min(1), z.number().int().positive()]),
  fields: z.array(z.string().min(1)).min(1).max(50),
  features: z.array(z.string().min(1)).max(50).default([]),
})

export const RevokeOAuthInputSchema = IdentityProfileInputSchema.extend({
  confirmation: z.string().min(1),
})

export const SegregationOfDutiesInputSchema = IdentityProfileInputSchema.extend({
  permissionGroups: z
    .array(
      z.object({
        name: z.string().min(1),
        permissions: z.array(z.string().min(1)).min(2).max(20),
      }),
    )
    .min(1)
    .max(20),
})

const IdentitySchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  role: z.union([z.string(), z.number()]).optional(),
  roleId: z.union([z.string(), z.number()]).optional(),
  roleCenter: z.string().optional(),
})

const VisibilitySchema = z.object({
  recordFamily: RecordFamilySchema,
  visibleCount: z.number().int().nonnegative().optional(),
  allowed: z.boolean(),
  restrictionReason: z.string().optional(),
})

export const AuthenticationDiagnosisOutputSchema = z.object({
  profile: IdentityProfileSchema,
  accountId: z.string(),
  environment: z.enum(["sandbox", "production"]),
  oauthFlow: z.enum(["client_credentials", "authorization_code"]),
  configured: z.boolean(),
  authenticated: z.boolean(),
  classification: z.string(),
  likelyCause: z.string().optional(),
  checks: z.array(
    z.object({ name: z.string(), passed: z.boolean(), detail: z.string().optional() }),
  ),
  identity: IdentitySchema.optional(),
})

export const RoleAccessOutputSchema = z.object({
  profile: IdentityProfileSchema,
  identity: IdentitySchema,
  visibility: z.array(VisibilitySchema),
  permissions: z.array(
    z.object({ name: z.string(), level: z.number().int(), allowed: z.boolean() }),
  ),
})

export const RoleComparisonOutputSchema = z.object({
  currentIdentity: IdentitySchema,
  managementIdentity: IdentitySchema,
  matrix: z.array(
    z.object({
      recordFamily: RecordFamilySchema,
      currentVisibleCount: z.number().int().nonnegative().optional(),
      managementVisibleCount: z.number().int().nonnegative().optional(),
      difference: z.number().int().optional(),
      currentRestriction: z.string().optional(),
      managementRestriction: z.string().optional(),
    }),
  ),
  permissions: z.array(
    z.object({
      name: z.string(),
      currentLevel: z.number().int(),
      managementLevel: z.number().int(),
    }),
  ),
})

export const LoginAuditTrailOutputSchema = z.object({
  profile: IdentityProfileSchema,
  entries: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export const TokenMetadataOutputSchema = z.object({
  profile: IdentityProfileSchema,
  accountId: z.string(),
  environment: z.enum(["sandbox", "production"]),
  oauthFlow: z.enum(["client_credentials", "authorization_code"]),
  hasRefreshToken: z.boolean(),
  hasClientCredentials: z.boolean(),
  hasCertificateCredentials: z.boolean(),
  cachedAccessToken: z.boolean(),
})

export const OAuthRevocationOutputSchema = z.object({
  profile: IdentityProfileSchema,
  revoked: z.boolean(),
  localCacheCleared: z.boolean(),
  requiresProcessRestart: z.boolean(),
})

export const IdentityRelationshipOutputSchema = z.object({
  profile: IdentityProfileSchema,
  accountId: z.string(),
  oauthFlow: z.enum(["client_credentials", "authorization_code"]),
  integrationConfigured: z.boolean(),
  user: IdentitySchema,
})

export const TokenEligibilityOutputSchema = z.object({
  profile: IdentityProfileSchema,
  eligible: z.boolean(),
  oauthFlow: z.enum(["client_credentials", "authorization_code"]),
  accountId: z.string(),
  identity: IdentitySchema,
  requirements: z.array(z.string()),
})

export const IntegrationStateOutputSchema = z.object({
  profile: IdentityProfileSchema,
  integrationId: z.union([z.string(), z.number()]),
  state: z.record(z.string(), JsonValueSchema),
  features: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
})

export const SegregationOfDutiesOutputSchema = z.object({
  profile: IdentityProfileSchema,
  identity: IdentitySchema,
  evaluatedGroups: z.number().int().nonnegative(),
  conflicts: z.array(
    z.object({
      name: z.string(),
      permissions: z.array(z.object({ name: z.string(), level: z.number().int() })),
    }),
  ),
})
