import type { Metadata } from "next";
import LegalArticle from "@/components/legal-article";
import { PRIVACY_POLICY } from "@/lib/legal";

export const metadata: Metadata = {
  title: PRIVACY_POLICY.title,
  description: PRIVACY_POLICY.description,
};

export default function PrivacyPolicyPage() {
  return <LegalArticle doc={PRIVACY_POLICY} />;
}
