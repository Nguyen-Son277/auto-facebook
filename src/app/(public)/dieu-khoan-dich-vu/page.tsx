import type { Metadata } from "next";
import LegalArticle from "@/components/legal-article";
import { TERMS_OF_SERVICE } from "@/lib/legal";

export const metadata: Metadata = {
  title: TERMS_OF_SERVICE.title,
  description: TERMS_OF_SERVICE.description,
};

export default function TermsOfServicePage() {
  return <LegalArticle doc={TERMS_OF_SERVICE} />;
}
