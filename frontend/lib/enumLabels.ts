import type { TranslationKey } from "./i18n";

// Maps backend enum values (which are stored/compared in English) to the
// translation key used to render them. Each returns null for values we don't
// know about so callers can fall back to showing the raw value.

export function paymentMethodKey(method: string): TranslationKey | null {
  switch (method) {
    case "CASH":
      return "payment.cash";
    case "UPI":
      return "payment.upi";
    case "CARD":
      return "payment.card";
    case "CREDIT":
      return "payment.credit";
    case "DUE_ADJUST":
      return "payment.dueAdjust";
    default:
      return null;
  }
}

export function orderStatusKey(status: string): TranslationKey | null {
  switch (status) {
    case "NEW":
      return "orderStatus.new";
    case "PACKING":
      return "orderStatus.packing";
    case "READY":
      return "orderStatus.ready";
    case "COLLECTED":
      return "orderStatus.collected";
    case "CANCELLED":
      return "orderStatus.cancelled";
    default:
      return null;
  }
}

export function purchaseOrderStatusKey(status: string): TranslationKey | null {
  switch (status) {
    case "DRAFT":
      return "poStatus.draft";
    case "SENT":
      return "poStatus.sent";
    case "RECEIVED":
      return "poStatus.received";
    case "CANCELLED":
      return "poStatus.cancelled";
    default:
      return null;
  }
}

export function transferStatusKey(status: string): TranslationKey | null {
  switch (status) {
    case "PENDING":
      return "transferStatus.pending";
    case "SHIPPED":
      return "transferStatus.shipped";
    case "RECEIVED":
      return "transferStatus.received";
    default:
      return null;
  }
}

export function roleKey(role: string): TranslationKey | null {
  switch (role) {
    case "admin":
      return "role.admin";
    case "cashier":
      return "role.cashier";
    case "franchisor":
      return "role.franchisor";
    default:
      return null;
  }
}

export function warrantyEventKey(type: string): TranslationKey | null {
  switch (type) {
    case "SOLD":
      return "warrantyEvent.sold";
    case "RETURNED":
      return "warrantyEvent.returned";
    case "CLAIM":
      return "warrantyEvent.claim";
    default:
      return null;
  }
}

export function productCategoryKey(category: string): TranslationKey | null {
  switch (category) {
    case "Groceries":
      return "category.groceries";
    case "Beverages":
      return "category.beverages";
    case "Snacks":
      return "category.snacks";
    case "Household":
      return "category.household";
    case "Personal Care":
      return "category.personalCare";
    case "Stationery":
      return "category.stationery";
    case "Electronics":
      return "category.electronics";
    case "Clothing":
      return "category.clothing";
    case "Footwear":
      return "category.footwear";
    case "Toys":
      return "category.toys";
    case "Pharmacy":
      return "category.pharmacy";
    case "Other":
      return "category.other";
    default:
      return null;
  }
}

export function unitNameKey(code: string): TranslationKey | null {
  switch (code) {
    case "BAG":
      return "unit.BAG";
    case "BAL":
      return "unit.BAL";
    case "BDL":
      return "unit.BDL";
    case "BOX":
      return "unit.BOX";
    case "BTL":
      return "unit.BTL";
    case "CAN":
      return "unit.CAN";
    case "CTN":
      return "unit.CTN";
    case "DOZ":
      return "unit.DOZ";
    case "DRM":
      return "unit.DRM";
    case "GMS":
      return "unit.GMS";
    case "GRS":
      return "unit.GRS";
    case "KGS":
      return "unit.KGS";
    case "KLR":
      return "unit.KLR";
    case "MLT":
      return "unit.MLT";
    case "MTR":
      return "unit.MTR";
    case "MTS":
      return "unit.MTS";
    case "NOS":
      return "unit.NOS";
    case "PAC":
      return "unit.PAC";
    case "PCS":
      return "unit.PCS";
    case "PRS":
      return "unit.PRS";
    case "QTL":
      return "unit.QTL";
    case "ROL":
      return "unit.ROL";
    case "SET":
      return "unit.SET";
    case "SQF":
      return "unit.SQF";
    case "SQM":
      return "unit.SQM";
    case "TBS":
      return "unit.TBS";
    case "THD":
      return "unit.THD";
    case "TON":
      return "unit.TON";
    case "TUB":
      return "unit.TUB";
    case "UNT":
      return "unit.UNT";
    case "YDS":
      return "unit.YDS";
    case "OTH":
      return "unit.OTH";
    default:
      return null;
  }
}
