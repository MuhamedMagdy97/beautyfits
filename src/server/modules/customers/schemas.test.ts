import { describe, expect, it } from "vitest";
import {
  createAddressSchema,
  updateAddressSchema,
  updateProfileSchema,
} from "@/server/modules/customers/schemas";

const AREA = "019a0000-0000-7000-8000-000000000001";

describe("address schemas", () => {
  it("normalizes the phone and turns blank optional text into null", () => {
    const parsed = createAddressSchema.parse({
      recipientName: " Mona ",
      phone: "٠١١١٢٣٤٥٦٧٨",
      areaId: AREA,
      street: "12 Main St",
      building: "  ",
    });
    expect(parsed).toMatchObject({ recipientName: "Mona", phone: "+201112345678", building: null });
  });

  it("requires recipient, phone, area and street on create, any one field on update", () => {
    expect(createAddressSchema.safeParse({ areaId: AREA }).success).toBe(false);
    expect(updateAddressSchema.safeParse({}).success).toBe(false);
    expect(updateAddressSchema.safeParse({ notes: null }).success).toBe(true);
    expect(updateAddressSchema.safeParse({ street: "" }).success).toBe(false);
  });
});

describe("profile schema", () => {
  it("accepts a past date of birth and rejects future or ancient ones", () => {
    expect(updateProfileSchema.safeParse({ dateOfBirth: "1995-04-30" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ dateOfBirth: "1899-12-31" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ dateOfBirth: "2999-01-01" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ dateOfBirth: "30/04/1995" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
});
