/**
 * Contact Picker API (experimental) — https://w3c.github.io/contact-picker/
 * Not included in default TypeScript DOM libs.
 */

interface ContactName {
  readonly givenName?: ReadonlyArray<string>;
  readonly familyName?: ReadonlyArray<string>;
  readonly middleName?: ReadonlyArray<string>;
  readonly namePrefix?: ReadonlyArray<string>;
  readonly nameSuffix?: ReadonlyArray<string>;
  readonly nickname?: ReadonlyArray<string>;
}

interface ContactInfo {
  readonly name?: ReadonlyArray<ContactName>;
  readonly email?: ReadonlyArray<string>;
  readonly tel?: ReadonlyArray<string>;
  readonly address?: ReadonlyArray<unknown>;
  readonly icon?: ReadonlyArray<Blob>;
}

type ContactProperty = "name" | "email" | "tel" | "address" | "icon";

interface ContactsSelectOptions {
  multiple?: boolean;
}

interface ContactsManager {
  select(
    properties: ContactProperty[],
    options?: ContactsSelectOptions,
  ): Promise<ContactInfo[]>;
}

interface Navigator {
  readonly contacts?: ContactsManager;
}

interface Window {
  ContactsManager?: {
    prototype: ContactsManager;
    new (): ContactsManager;
  };
}
