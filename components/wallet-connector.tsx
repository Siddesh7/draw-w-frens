import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Wallet } from "lucide-react";

import { trimAddress } from "@/lib/utils";

export default function WalletConnector() {
  const { authenticated, ready, login, logout } = usePrivy();
  const { address } = useAccount();
  return (
    <>
      {authenticated && ready ? (
        <div className="flex flex-row gap-2">
          <Badge variant={"outline"} className="h-9 text-sm">
            <Wallet />
            {trimAddress(address as string)}
          </Badge>
          <Button onClick={logout} className="cursor-pointer">
            Logout
          </Button>
        </div>
      ) : (
        <Button onClick={login} className="cursor-pointer">
          Login
        </Button>
      )}
    </>
  );
}
