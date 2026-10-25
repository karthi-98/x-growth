"use client"

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AiKeyForm } from "@/components/settings/ai-key-form"
import { XKeysForm } from "@/components/settings/x-keys-form"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter } from "@/components/ui/card"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

/**
 * The X keys and AI key steps: the form comes from its owning workstream
 * (compose / ai, docs/WORKSTREAMS.md); saving it moves the wizard on.
 */
export function KeyStep({ kind, saved, back, next }: { kind: "x" | "ai"; saved: boolean; back: string; next: string }) {
  const router = useRouter()
  const onSaved = () => router.push(next)
  return (
    <>
      <CardContent>{kind === "x" ? <XKeysForm onSaved={onSaved} /> : <AiKeyForm onSaved={onSaved} />}</CardContent>
      <CardFooter className="justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={back}>
            <ArrowLeftIcon />
            Back
          </Link>
        </Button>
        <Button variant={saved ? "default" : "outline"} size="sm" asChild>
          <Link href={next}>
            {saved ? "Continue" : "Skip for now"}
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </>
  )
}
