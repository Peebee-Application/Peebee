"use client";
import { ActivationPage } from "@peebee/shared/activation";
import { useAuth } from "../../lib/auth-context";
export default function Activate() {
  const { setSession } = useAuth();
  return <ActivationPage apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10000"} accountType="rider" onActivated={setSession}/>;
}