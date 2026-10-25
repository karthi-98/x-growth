// Owner: runtime workstream (docs/WORKSTREAMS.md).

/** The /setup wizard, in order. The current step is in ?step= so back/forward work. */
export const setupSteps = [
  { id: "welcome", title: "Welcome" },
  { id: "x-keys", title: "X keys" },
  { id: "ai-key", title: "AI key" },
  { id: "first-sync", title: "First sync" },
  { id: "done", title: "Done" },
] as const

export type SetupStepId = (typeof setupSteps)[number]["id"]

export function parseStep(value: string | string[] | undefined): SetupStepId {
  const id = Array.isArray(value) ? value[0] : value
  return setupSteps.find((s) => s.id === id)?.id ?? "welcome"
}

export const stepHref = (id: SetupStepId) => (id === "welcome" ? "/setup" : `/setup?step=${id}`)

const indexOf = (id: SetupStepId) => setupSteps.findIndex((s) => s.id === id)

export const nextStep = (id: SetupStepId): SetupStepId => setupSteps[Math.min(indexOf(id) + 1, setupSteps.length - 1)].id

export const previousStep = (id: SetupStepId): SetupStepId => setupSteps[Math.max(indexOf(id) - 1, 0)].id
