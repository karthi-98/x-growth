"use server"

import { revalidatePath } from "next/cache"

import { validateGeneralSettings, type GeneralFormState } from "@/components/settings/general-validate"
import { updateSettings } from "@/lib/settings"

/**
 * Save handle, timezone and pay periods. Validates again on the server (the
 * form's checks are only for feedback), then refreshes every page, since the
 * timezone changes day bucketing and labels across the app.
 */
export async function saveGeneralSettings(
  _prev: GeneralFormState,
  formData: FormData
): Promise<GeneralFormState> {
  const result = validateGeneralSettings(formData)
  if (!result.ok) return { status: "error", errors: result.errors }
  await updateSettings(result.patch)
  revalidatePath("/", "layout")
  const { handle, timeZone } = result.patch
  return { status: "saved", errors: {}, savedAt: Date.now(), saved: { handle, timeZone } }
}
