import axe from "axe-core"

const RULES = [
  "area-alt",
  "aria-allowed-attr",
  "aria-hidden-focus",
  "aria-input-field-name",
  "aria-required-attr",
  "aria-roles",
  "aria-toggle-field-name",
  "aria-valid-attr",
  "aria-valid-attr-value",
  "button-name",
  "definition-list",
  "dlitem",
  "duplicate-id-aria",
  "form-field-multiple-labels",
  "image-alt",
  "input-image-alt",
  "label",
  "link-name",
  "list",
  "listitem",
  "nested-interactive",
  "select-name",
  "svg-img-alt",
  "tabindex",
]

export interface A11yViolation {
  id: string
  impact: string | null
  targets: string[]
  html: string[]
}

export async function a11yViolations(container: HTMLElement): Promise<A11yViolation[]> {
  const results = await axe.run(container, {
    runOnly: { type: "rule", values: RULES },
  })

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    targets: violation.nodes.map((node) => node.target.join(" ")),
    html: violation.nodes.map((node) => node.html),
  }))
}
