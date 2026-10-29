/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import Layout from "../../components/Layout";
import AccountProfilePage from "./AccountProfilePage";
import { useProfileI18n } from "./profileMessages";

export default function StandaloneProfilePage() {
  const { text } = useProfileI18n();
  return <Layout headerTitle={text("title")} hideSidebar hideHeader><AccountProfilePage /></Layout>;
}
