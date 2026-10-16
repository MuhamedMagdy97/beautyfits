"use client";

import { useEffect, useRef } from "react";

/**
 * Replaces the browser's built-in validation bubbles ("Please select an item in
 * the list") with brand-styled messages under the field, in the field's
 * language, for every form of the storefront and the staff dashboard.
 *
 * Fields keep their native constraints (`required`, `type="email"`,
 * `minLength`…); this only changes how a failed check is shown. The message
 * is put on the field's `<label>` / `<fieldset>` as `data-error` (styled in
 * globals.css) and read out once through a live region.
 */

type Lang = "ar" | "en";
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const TEXT = {
  required: { ar: "هذا الحقل مطلوب.", en: "This field is required." },
  choose: { ar: "اختر من القائمة.", en: "Please choose an option." },
  chooseOne: { ar: "اختر أحد الخيارات.", en: "Please choose one option." },
  tick: { ar: "يرجى تحديد هذا الخيار.", en: "Please tick this box." },
  file: { ar: "يرجى إضافة ملف.", en: "Please add a file." },
  email: { ar: "أدخل بريدًا إلكترونيًا صحيحًا.", en: "Enter a valid email address." },
  format: { ar: "تحقق من صيغة هذه القيمة.", en: "Check the format of this value." },
  tooShort: { ar: "أدخل {n} أحرف على الأقل.", en: "Use at least {n} characters." },
  tooLong: { ar: "أدخل {n} حرفًا كحد أقصى.", en: "Use at most {n} characters." },
  min: { ar: "يجب ألا تقل القيمة عن {n}.", en: "The value must be at least {n}." },
  max: { ar: "يجب ألا تزيد القيمة عن {n}.", en: "The value must be at most {n}." },
} as const;

function langOf(el: Element): Lang {
  return el.closest("[lang]")?.getAttribute("lang") === "en" ? "en" : "ar";
}

/** The localized message for a field that failed its constraints. */
export function validationMessage(field: Field, lang: Lang): string {
  const v = field.validity;
  const type = field instanceof HTMLInputElement ? field.type : "";
  const say = (key: keyof typeof TEXT, n?: number | string) =>
    TEXT[key][lang].replace("{n}", String(n ?? ""));
  if (v.valueMissing) {
    if (field instanceof HTMLSelectElement) return say("choose");
    if (type === "radio") return say("chooseOne");
    if (type === "checkbox") return say("tick");
    if (type === "file") return say("file");
    return say("required");
  }
  if (v.typeMismatch) return say(type === "email" ? "email" : "format");
  if (v.tooShort && "minLength" in field) return say("tooShort", field.minLength);
  if (v.tooLong && "maxLength" in field) return say("tooLong", field.maxLength);
  if (v.rangeUnderflow && field instanceof HTMLInputElement) return say("min", field.min);
  if (v.rangeOverflow && field instanceof HTMLInputElement) return say("max", field.max);
  return say("format");
}

/** Where the message is shown: the field's fieldset (radio groups) or label. */
function holderOf(field: Field): HTMLElement | null {
  return (
    (field.type === "radio" ? field.closest("fieldset") : null) ??
    field.closest("label") ??
    field.parentElement
  );
}

function clear(field: Field) {
  field.removeAttribute("aria-invalid");
  holderOf(field)?.removeAttribute("data-error");
  if (field instanceof HTMLInputElement && field.type === "radio" && field.form) {
    for (const el of field.form.querySelectorAll(`input[name="${CSS.escape(field.name)}"]`)) {
      el.removeAttribute("aria-invalid");
    }
  }
}

export function FormValidation() {
  const live = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let firstOfSubmit = true;

    function onInvalid(event: Event) {
      const field = event.target as Field;
      if (!("validity" in field)) return;
      event.preventDefault(); // no browser bubble
      const message = validationMessage(field, langOf(field));
      field.setAttribute("aria-invalid", "true");
      holderOf(field)?.setAttribute("data-error", message);
      // A submit fires `invalid` for each failing field in order: focus and
      // announce the first one only.
      if (firstOfSubmit) {
        firstOfSubmit = false;
        field.focus();
        if (live.current) live.current.textContent = message;
        queueMicrotask(() => {
          firstOfSubmit = true;
        });
      }
    }

    function onEdit(event: Event) {
      const field = event.target as Field;
      // `validity.valid`, not checkValidity(): that would fire `invalid` again.
      if (field.getAttribute?.("aria-invalid") === "true" && field.validity?.valid) {
        clear(field);
      }
    }

    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);

  return <p ref={live} role="status" aria-live="polite" className="sr-only" />;
}
