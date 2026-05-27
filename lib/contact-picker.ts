/**
 * Browser Contact Picker API helpers for /players.
 *
 * Only invoked after an explicit user click — never auto-request contacts.
 */

export type PickedContact = {
  name: string;
  email: string;
  phone: string;
};

/** Feature detection per Contact Picker spec. */
export function isContactPickerSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return "contacts" in navigator && "ContactsManager" in window;
}

function formatContactName(entry: ContactName | undefined): string {
  if (!entry) return "";
  const parts: string[] = [];
  const pushFirst = (values?: ReadonlyArray<string>) => {
    const v = values?.[0]?.trim();
    if (v) parts.push(v);
  };
  pushFirst(entry.givenName);
  pushFirst(entry.middleName);
  pushFirst(entry.familyName);
  if (parts.length > 0) return parts.join(" ");
  pushFirst(entry.nickname);
  return parts.join(" ");
}

/**
 * Open the system contact picker (single contact). Returns `null` when the
 * user dismisses without selecting. Throws on unexpected API errors.
 */
export async function pickContactFromDevice(): Promise<PickedContact | null> {
  if (!isContactPickerSupported() || !navigator.contacts) {
    return null;
  }

  const contacts = await navigator.contacts.select(
    ["name", "email", "tel"],
    { multiple: false },
  );

  if (!contacts?.length) return null;

  const contact = contacts[0];
  return {
    name: formatContactName(contact.name?.[0]),
    email: (contact.email?.[0] ?? "").trim(),
    phone: (contact.tel?.[0] ?? "").trim(),
  };
}
