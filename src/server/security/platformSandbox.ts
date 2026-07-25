type SandboxMechanism = "seatbelt" | "landlock" | "none";

export interface SandboxPlatformFacts {
  kernelSupported: boolean;
  mechanism: SandboxMechanism;
  childNetworkRestriction: boolean;
  note: string;
}

export function sandboxPlatformFacts(platform: NodeJS.Platform): SandboxPlatformFacts {
  if (platform === "darwin") {
    return {
      kernelSupported: true,
      mechanism: "seatbelt",
      childNetworkRestriction: false,
      note: "macOS Seatbelt enforces filesystem profiles for the Grok process lifetime. Child-process network restriction is not enforced on macOS.",
    };
  }
  if (platform === "linux") {
    return {
      kernelSupported: true,
      mechanism: "landlock",
      childNetworkRestriction: true,
      note: "Linux uses kernel sandboxing for filesystem access and can restrict child-process networking for supported profiles.",
    };
  }
  return {
    kernelSupported: false,
    mechanism: "none",
    childNetworkRestriction: false,
    note: "Grok documents kernel sandbox profiles for macOS and Linux only. Permission policy is not a kernel sandbox.",
  };
}
