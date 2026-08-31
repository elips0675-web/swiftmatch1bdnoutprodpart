import { Utensils, BedDouble, Flower2, Car, ShoppingBag, MapPin } from "lucide-react";

export const GO_OUT_ICONS: Record<string, React.ElementType> = {
  restaurant: Utensils,
  cafe: Utensils,
  hotel: BedDouble,
  flowers: Flower2,
  taxi: Car,
  gift: ShoppingBag,
};

export const GO_OUT_COLORS: Record<string, string> = {
  restaurant: "bg-orange-100 text-orange-700",
  cafe: "bg-orange-100 text-orange-700",
  hotel: "bg-indigo-100 text-indigo-700",
  flowers: "bg-pink-100 text-pink-700",
  taxi: "bg-sky-100 text-sky-700",
  gift: "bg-amber-100 text-amber-700",
};

export const GO_OUT_FALLBACK_ICON = MapPin;
export const GO_OUT_FALLBACK_COLOR = "bg-slate-100 text-slate-600";
