/**
 * Icon component — maps Material Symbols names to Lucide React SVG icons.
 *
 * Why this exists:
 * Shopify's admin iframe has a strict Content-Security-Policy that blocks
 * external font loading from Google Fonts (fonts.googleapis.com).
 * Material Symbols font icons therefore show as broken characters.
 *
 * Lucide React renders pure inline SVGs, which are never blocked by CSP
 * and work perfectly inside the Shopify embedded app iframe.
 */

import React from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AlignLeft,
  AlignRight,
  ArrowRight,
  BadgeCheck,
  Ban,
  BarChart3,
  Bolt,
  BookOpen,
  Bot,
  Braces,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Compass,
  Copy,
  CreditCard,
  Download,
  Eye,
  ExternalLink,
  FileSearch,
  FileText,
  Frown,
  Gift,
  Globe,
  Heart,
  Hourglass,
  Image,
  Images,
  Info,
  Lightbulb,
  Link,
  Mail,
  Megaphone,
  Meh,
  MessageSquareText,
  MoreHorizontal,
  MousePointerClick,
  Package,
  Plug,
  Plus,
  Receipt,
  Route,
  Save,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Star,
  Store,
  Trash2,
  Trophy,
  TrendingUp,
  Users,
  UserPlus,
  Wallet,
  Wand2,
  X,
  XCircle,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  // Dashboard / common
  payments: Wallet,
  group: Users,
  rate_review: MessageSquareText,
  card_membership: CreditCard,
  mail: Mail,
  loyalty: Heart,
  campaign: Megaphone,
  group_add: UserPlus,
  search: Search,
  bar_chart: BarChart3,
  storefront: Store,
  star: Star,
  redeem: Gift,
  person_add: UserPlus,
  manage_search: FileSearch,
  check: Check,
  chevron_right: ChevronRight,
  arrow_forward: ArrowRight,

  // Status / feedback
  check_circle: CheckCircle,
  error: XCircle,
  error_outline: AlertCircle,
  cancel: XCircle,
  block: Ban,
  delete: Trash2,
  warning: AlertTriangle,
  info: Info,
  report: AlertTriangle,

  // Actions
  add: Plus,
  add_comment: MessageSquareText,
  save: Save,
  settings: Settings,
  bolt: Bolt,
  tune: SlidersHorizontal,
  cable: Plug,
  open_in_new: ExternalLink,
  auto_fix_high: Wand2,
  auto_awesome: Sparkles,
  more_horiz: MoreHorizontal,

  // Navigation
  chevron_left: ChevronLeft,

  // Reviews
  reviews: MessageSquareText,
  pending: Clock,
  photo_library: Images,
  sentiment_satisfied: Smile,
  sentiment_dissatisfied: Frown,
  sentiment_neutral: Meh,

  // Loyalty
  stars: Sparkles,
  toll: CircleDollarSign,
  receipt_long: Receipt,
  leaderboard: Trophy,
  insights: TrendingUp,

  // SEO
  schedule: CalendarClock,
  hourglass_top: Hourglass,
  description: FileText,
  image_search: Image,
  data_object: Braces,
  travel_explore: Compass,
  public: Globe,
  web: Globe,

  // FOMO
  visibility: Eye,
  ads_click: MousePointerClick,
  align_horizontal_left: AlignLeft,
  align_horizontal_right: AlignRight,
  integration_instructions: BookOpen,
  content_copy: Copy,
  preview: Eye,
  shopping_bag: ShoppingBag,
  close: X,
  verified: BadgeCheck,
  lightbulb: Lightbulb,

  // Analytics
  conversion_path: Route,
  inventory_2: Package,
  link: Link,
  calendar_today: Calendar,
  download: Download,

  // Billing
  data_usage: Activity,
  smart_toy: Bot,
  expand_more: ChevronDown,
  business: Building2,
};

export interface IconProps extends Omit<LucideProps, "ref"> {
  name: string;
}

/**
 * Render a Lucide SVG icon by its Material Symbols name.
 *
 * @example
 * <Icon name="search" size={18} className="text-primary" />
 * <Icon name="star" size={14} fill="#f59e0b" color="#f59e0b" />
 */
export function Icon({ name, size = 24, className, ...rest }: IconProps) {
  const LucideIcon = ICON_MAP[name];
  if (!LucideIcon) {
    // Graceful fallback: render nothing rather than a broken glyph
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Icon] No Lucide mapping for Material Symbols name: "${name}"`);
    }
    return null;
  }
  return <LucideIcon size={size} className={className} {...rest} />;
}

/**
 * Star rating row — replaces the Material Symbols filled-star pattern.
 */
export function StarRow({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "md";
}) {
  const px = size === "md" ? 18 : 14;
  return (
    <span
      className="inline-flex items-center gap-[1px]"
      aria-label={`${rating} out of 5 stars`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={px}
          fill={i < rating ? "#f59e0b" : "none"}
          color={i < rating ? "#f59e0b" : "#d1d5db"}
        />
      ))}
    </span>
  );
}
