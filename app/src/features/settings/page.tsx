import { IconCheck, IconLoader2, IconMail } from "@tabler/icons-react"
import { type FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { AppRoutes, PageName } from "@/app/routes"
import { useMe } from "@/app/providers/me-provider/context"
import { PageLayout } from "@/components/layout"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  useRequestPasswordResetMutation,
  useUpdateMeMutation,
} from "@/queries/mutations"

function getInitials(name: string | null | undefined, email: string): string {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }
  return email[0].toUpperCase()
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const user = useMe()

  const [name, setName] = useState(user.name ?? "")
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const updateMeMutation = useUpdateMeMutation()
  const resetMutation = useRequestPasswordResetMutation()

  useEffect(() => {
    setName(user.name ?? "")
  }, [user.name])

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    setSaveSuccess(false)
    updateMeMutation.mutate(
      { name: name.trim() || null, avatar_url: null },
      {
        onSuccess: () => {
          setSaveSuccess(true)
          setTimeout(() => setSaveSuccess(false), 3000)
        },
      },
    )
  }

  const handleRequestReset = () => {
    setResetSent(false)
    resetMutation.mutate(undefined, {
      onSuccess: () => setResetSent(true),
    })
  }

  const initials = getInitials(name || user.name, user.email)

  return (
    <PageLayout>
      <PageLayout.FullScreenBody>
        <div className="min-h-screen bg-background flex flex-col">
          <div className="border-b border-border px-6 py-4 flex items-center gap-4">
            <button
              onClick={() => void navigate(AppRoutes.getRoute(PageName.Home))}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-lg font-semibold">Account Settings</h1>
          </div>

          <div className="flex-1 flex justify-center px-4 py-10">
            <div className="w-full max-w-lg space-y-8">

              {/* Profile section */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Profile
                </h2>
                <div className="bg-card border border-border rounded-xl p-6 space-y-6">
                  {/* Avatar preview */}
                  <div className="flex items-center gap-4">
                    <Avatar size="lg" className="size-16">
                      <AvatarFallback className="text-lg">{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{name || user.email}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                    </div>
                  </div>

                  <Separator />

                  <form onSubmit={handleSave} className="space-y-4">
                    {/* Email (read-only) */}
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={user.email}
                        disabled
                        className="bg-muted/50"
                      />
                    </div>

                    {/* Display name */}
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Display name</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        type="submit"
                        disabled={updateMeMutation.isPending}
                      >
                        {updateMeMutation.isPending ? (
                          <>
                            <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving…
                          </>
                        ) : saveSuccess ? (
                          <>
                            <IconCheck className="mr-2 h-4 w-4" />
                            Saved
                          </>
                        ) : (
                          "Save changes"
                        )}
                      </Button>
                      {updateMeMutation.isError && (
                        <p className="text-sm text-destructive">
                          {updateMeMutation.error.message}
                        </p>
                      )}
                    </div>
                  </form>
                </div>
              </section>

              {/* Security section */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Security
                </h2>
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">Password</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        We'll email you a link to reset your password.
                      </p>
                      {resetSent && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                          Reset link sent — check your inbox.
                        </p>
                      )}
                      {resetMutation.isError && (
                        <p className="text-sm text-destructive mt-1">
                          {resetMutation.error.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleRequestReset}
                      disabled={resetMutation.isPending || resetSent}
                    >
                      {resetMutation.isPending ? (
                        <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <IconMail className="mr-2 h-4 w-4" />
                      )}
                      {resetSent ? "Email sent" : "Send reset email"}
                    </Button>
                  </div>
                </div>
              </section>

            </div>
          </div>
        </div>
      </PageLayout.FullScreenBody>
    </PageLayout>
  )
}
