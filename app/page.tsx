// page.tsx

"use client";

import { useState, useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import WalletConnector from "@/components/wallet-connector";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useWatchContractEvent } from "wagmi";
import { parseEther, formatEther, isAddress } from "viem"; // Using isAddress from viem
import {
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { privateKeyToAccount } from "viem/accounts";

// --- Constants ---
const ESCROW_CONTRACT_ADDRESS =
  "0x5DB6B35acfa818B70168E761657BD30Ca72B5838" as `0x${string}`; // <<< ENSURE THIS IS CORRECT
const DEPOSIT_AMOUNT_ETH = "0.0005";
const DEPOSIT_AMOUNT_WEI = parseEther(DEPOSIT_AMOUNT_ETH);
const TARGET_CHAIN_ID = 84532; // Base Sepolia
const MAX_PLAYERS_PER_ROOM = 10;
const MIN_PLAYERS_PER_ROOM = 1; // Use 1 for testing, 2+ for real game

// Helper for case-insensitive address comparison
const isAddressEqual = (addr1?: string, addr2?: string): boolean => {
  if (!addr1 || !addr2 || !isAddress(addr1) || !isAddress(addr2)) {
    return false;
  }
  return addr1.toLowerCase() === addr2.toLowerCase();
};

// --- Smart Contract ABI (Make sure this matches your deployed contract) ---
const ESCROW_ABI = [
  {
    inputs: [
      { internalType: "string", name: "roomId", type: "string" },
      { internalType: "address", name: "winner", type: "address" },
    ],
    name: "declareWinner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "roomId", type: "string" }],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "roomId",
        type: "string",
      },
      {
        indexed: false,
        internalType: "address",
        name: "player",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "DepositMade",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "roomId",
        type: "string",
      },
      {
        indexed: false,
        internalType: "address",
        name: "player",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "FundsWithdrawn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "roomId",
        type: "string",
      },
      {
        indexed: false,
        internalType: "address",
        name: "winner",
        type: "address",
      },
    ],
    name: "WinnerDeclared",
    type: "event",
  },
  {
    inputs: [{ internalType: "string", name: "roomId", type: "string" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "", type: "string" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "deposits",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "roomId", type: "string" }],
    name: "getRoomInfo",
    outputs: [
      { internalType: "address[]", name: "players", type: "address[]" },
      { internalType: "uint256", name: "totalDeposited", type: "uint256" },
      { internalType: "address", name: "winner", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "", type: "string" }],
    name: "rooms",
    outputs: [
      { internalType: "uint256", name: "totalDeposited", type: "uint256" },
      { internalType: "address", name: "winner", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export default function Home() {
  // --- Hooks ---
  const { authenticated } = usePrivy();
  const { address, chainId } = useAccount();
  const searchParams = useSearchParams();
  const { writeContractAsync } = useWriteContract();

  // --- Refs ---
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isDrawingRef = useRef<boolean>(false); // <<< Ref for drawing state

  // --- Component State ---
  const [isConnected, setIsConnected] = useState(false); // WebSocket connection status
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false); // Joined Socket Room?
  const [players, setPlayers] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [word, setWord] = useState("");
  const [currentDrawer, setCurrentDrawer] = useState("");
  const [guesses, setGuesses] = useState<string[]>([]);
  const [guessInput, setGuessInput] = useState("");
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(3);
  const [gameEnded, setGameEnded] = useState(false);
  const [gameWinner, setGameWinner] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(90);
  const [isAdmin, setIsAdmin] = useState(false); // Is THIS user admin?
  const [gameStarted, setGameStarted] = useState(false); // Skribbl game active?
  const [roundStartTime, setRoundStartTime] = useState<number>(0);
  const [gameCancelled, setGameCancelled] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isDepositPending, setIsDepositPending] = useState(false); // Blockchain Tx
  const [depositHash, setDepositHash] = useState<`0x${string}` | undefined>();
  const [declareWinnerHash, setDeclareWinnerHash] = useState<
    `0x${string}` | undefined
  >();
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | undefined>();
  const [gameLink, setGameLink] = useState<string>("");
  const [hasDeposited, setHasDeposited] = useState<boolean | null>(null); // Deposit status for current room
  const [isJoiningRoom, setIsJoiningRoom] = useState(false); // Loading state for "Enter Room" button

  // --- Wagmi Hooks ---
  const { data: userBalance } = useBalance({
    address: address,
    chainId: TARGET_CHAIN_ID,
  });
  const { data: contractOwner, isLoading: isLoadingOwner } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "owner",
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address },
  });
  const {
    data: userDepositData,
    refetch: refetchUserDeposit,
    isLoading: isLoadingUserDeposit,
  } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "deposits",
    args: [roomId || "", address!],
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address && !!roomId },
  });
  const { data: roomInfo, refetch: refetchRoomInfo } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getRoomInfo",
    args: [roomId || ""],
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!roomId },
  });
  // Tx Receipt Watchers
  const depositResult = useWaitForTransactionReceipt({
    hash: depositHash,
    chainId: TARGET_CHAIN_ID,
  });
  const declareWinnerResult = useWaitForTransactionReceipt({
    hash: declareWinnerHash,
    chainId: TARGET_CHAIN_ID,
  });
  const withdrawResult = useWaitForTransactionReceipt({
    hash: withdrawHash,
    chainId: TARGET_CHAIN_ID,
  });

  // --- Effects ---

  // Update local deposit state from contract read
  useEffect(() => {
    if (userDepositData !== undefined && userDepositData !== null)
      setHasDeposited(userDepositData >= DEPOSIT_AMOUNT_WEI);
    else if (!isLoadingUserDeposit && roomId && address) setHasDeposited(false);
    else setHasDeposited(null);
  }, [userDepositData, isLoadingUserDeposit, roomId, address]);

  // Handle Deposit TX Outcome
  useEffect(() => {
    if (depositResult.status === "success") {
      toast.success("Deposit successful!");
      setIsDepositPending(false);
      setDepositHash(undefined);
      setTimeout(() => {
        refetchUserDeposit().then(() => {
          if (isAdmin && address) joinRoomAfterDeposit();
        });
        refetchRoomInfo();
      }, 250);
    } else if (depositResult.status === "error") {
      toast.error(
        `Deposit failed: ${depositResult.error?.message || "Tx failed."}`
      );
      setIsDepositPending(false);
      setDepositHash(undefined);
    }
  }, [
    depositResult.status,
    depositResult.error,
    isAdmin,
    address,
    refetchUserDeposit,
    refetchRoomInfo,
  ]);

  // Handle Declare Winner TX Outcome
  useEffect(() => {
    if (declareWinnerResult.status === "success") {
      toast.success("Winner declared!");
      setDeclareWinnerHash(undefined);
      refetchRoomInfo();
    } else if (declareWinnerResult.status === "error") {
      toast.error(
        `Declare winner failed: ${declareWinnerResult.error?.message}`
      );
      setDeclareWinnerHash(undefined);
    }
  }, [declareWinnerResult.status, declareWinnerResult.error, refetchRoomInfo]);

  // Handle Withdraw TX Outcome
  useEffect(() => {
    if (withdrawResult.status === "success") {
      toast.success("Withdrawal successful!");
      setWithdrawHash(undefined);
      refetchRoomInfo();
      refetchUserDeposit();
    } else if (withdrawResult.status === "error") {
      toast.error(`Withdrawal failed: ${withdrawResult.error?.message}`);
      setWithdrawHash(undefined);
    }
  }, [
    withdrawResult.status,
    withdrawResult.error,
    refetchRoomInfo,
    refetchUserDeposit,
  ]);

  // Set Room ID from URL
  useEffect(() => {
    const roomIdFromUrl = searchParams.get("room");
    if (roomIdFromUrl) setRoomId(roomIdFromUrl);
  }, [searchParams]);

  // WebSocket Connection Management
  useEffect(() => {
    if (!address) {
      if (socketRef.current) {
        console.log("WS Cleanup: Wallet disconnect");
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
        setIsJoined(false);
      }
      return;
    }
    if (socketRef.current) {
      console.log("WS Cleanup: Address change / Effect re-run");
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsJoined(false);
    }

    const socketUrl =
      process.env.NODE_ENV === "development"
        ? "ws://localhost:3001"
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
            window.location.host
          }`;
    console.log(`(Effect) Init WS: ${socketUrl} for ${address}`);
    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      query: { address },
      transports: ["websocket"],
      forceNew: true,
    });
    socketRef.current = newSocket;
    setIsConnected(newSocket.connected);

    // --- Event Handler Definitions ---
    const handleConnect = () => {
      if (socketRef.current === newSocket) {
        console.log(`WS Connected: ${newSocket.id}`);
        setIsConnected(true);
        toast.dismiss("disconnect-toast");
        if (isJoined && roomId && address && hasDeposited === true) {
          console.log(`Reconnected. Re-joining: ${roomId}`);
          setIsJoiningRoom(true);
          socketRef.current?.emit("joinRoom", { roomId, username: address });
        }
      }
    };
    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      if (socketRef.current === newSocket) {
        console.warn(`WS Disconnected: ${reason}`);
        setIsConnected(false);
        setIsJoined(false);
        if (timerRef.current) clearInterval(timerRef.current);
        if (
          reason !== "io client disconnect" &&
          reason !== "io server disconnect"
        )
          toast.warning(`Conn lost: ${reason}. Reconnecting...`, {
            id: "disconnect-toast",
          });
      }
    };
    const handleConnectError = (err: Error) => {
      if (socketRef.current === newSocket) {
        console.error("WS Conn Err:", err.message);
        setIsConnected(false);
        toast.error(`Conn Error: ${err.message}.`);
        socketRef.current = null;
      }
    };
    const onRoomCreated = ({ roomId: newRoomId }: { roomId: string }) => {
      console.log("Event 'roomCreated':", newRoomId);
      setRoomId(newRoomId);
      setIsAdmin(true);
      setIsJoined(false);
      setGameLink(`${window.location.origin}?room=${newRoomId}`);
      window.history.pushState({}, "", `?room=${newRoomId}`);
      toast.info(
        `Room ${newRoomId} created. Deposit ${DEPOSIT_AMOUNT_ETH} ETH.`
      );
      refetchUserDeposit();
    };
    const onJoinedRoom = ({
      roomId: joinedRoomId,
      players,
      scores,
      admin,
    }: any) => {
      if (joinedRoomId === roomId) {
        console.log(`Event 'joinedRoom': ${joinedRoomId}`);
        setIsJoined(true);
        setPlayers(players.map((p: string) => p.toLowerCase()));
        setScores(scores);
        if (address) setIsAdmin(isAddressEqual(address, admin));
        setJoinError(null);
        setIsJoiningRoom(false);
        toast.success(`Entered room: ${roomId}`);
      }
    };
    const onJoinError = (message: string) => {
      console.error(`Event 'joinError': ${message}`);
      setJoinError(message);
      setIsJoined(false);
      setIsJoiningRoom(false);
      toast.error(`Join Fail: ${message}`);
    };
    const onPlayersUpdate = ({ players, scores, admin }: any) => {
      if (isJoined) {
        setPlayers(players.map((p: string) => p.toLowerCase()));
        setScores(scores);
        if (address) setIsAdmin(isAddressEqual(address, admin));
      }
    };
    const onGameStarted = () => {
      console.log("Event 'gameStarted'");
      setGameStarted(true);
      setGameEnded(false);
      setGameCancelled(false);
      setGameWinner(null);
      setGuesses([]);
      toast.success("Game Started!");
    };
    const onStartDrawing = ({
      drawer,
      word: receivedWord,
      round,
      maxRounds,
      time,
    }: any) => {
      console.log("Event 'startDrawing'", { drawer, word: receivedWord });
      setCurrentDrawer(drawer?.toLowerCase() ?? "");
      setWord(receivedWord);
      setRound(round);
      setMaxRounds(maxRounds);
      setGuesses([]);
      setTimeLeft(time ?? 90);
      setRoundStartTime(Date.now());
      clearCanvas();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - roundStartTime;
        const newTime = Math.max(
          0,
          Math.round(((time ?? 90) * 1000 - elapsed) / 1000)
        );
        setTimeLeft(newTime);
        if (newTime <= 0 && timerRef.current) clearInterval(timerRef.current);
      }, 1000);
    };
    const onGuessUpdate = (formattedGuess: string) => {
      setGuesses((prev) => [...prev, formattedGuess].slice(-100));
    };
    const onDraw = ({ x, y, type }: any) => {
      drawOnCanvas(x, y, type);
    };
    const onRoundEnd = ({
      winner,
      word: revealedWord,
      scores: updatedScores,
    }: any) => {
      console.log("Event 'roundEnd'", { winner, word: revealedWord });
      setWord(revealedWord);
      setScores(updatedScores);
      setTimeLeft(0);
      if (timerRef.current) clearInterval(timerRef.current);
      let msg = winner
        ? winner.startsWith("0x")
          ? `${winner.slice(0, 6)}... guessed!`
          : `${winner}`
        : `Round over!`;
      msg += ` Word: ${revealedWord}`;
      toast.info(msg, { duration: 5000 });
    };
    const onTimeUpdate = (time: number) => {
      if (gameStarted && !gameEnded) setTimeLeft(time ?? 0);
    };
    const onGameEnd = ({ scores: finalScores, winner, reason }: any) => {
      console.log("Event 'gameEnd'", { winner, reason });
      setScores(finalScores);
      setGameWinner(winner?.toLowerCase() || null);
      setGameEnded(true);
      setGameStarted(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast.success(
        `Game Over! ${
          winner ? `Winner: ${winner.slice(0, 6)}...` : reason || ""
        }`,
        { duration: 10000 }
      );
      if (
        address &&
        contractOwner &&
        isAddressEqual(address, contractOwner) &&
        winner
      )
        declareGameWinner(winner);
    };
    const onGameCancelled = (message: string) => {
      console.warn("Event 'gameCancelled':", message);
      setGameCancelled(true);
      setGameStarted(false);
      setIsJoined(false);
      toast.warning(`Game Cancelled: ${message}`, { duration: 10000 });
    };
    const onGameError = (message: string) => {
      console.error("Event 'gameError':", message);
      toast.error(message);
    };
    const onSystemMessage = (message: string) => {
      console.log("Event 'systemMessage':", message);
      toast.info(message);
    };

    // --- Attach Listeners ---
    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", handleDisconnect);
    newSocket.on("connect_error", handleConnectError);
    newSocket.on("roomCreated", onRoomCreated);
    newSocket.on("joinedRoom", onJoinedRoom);
    newSocket.on("joinError", onJoinError);
    newSocket.on("playersUpdate", onPlayersUpdate);
    newSocket.on("gameStarted", onGameStarted);
    newSocket.on("startDrawing", onStartDrawing);
    newSocket.on("guessUpdate", onGuessUpdate);
    newSocket.on("draw", onDraw);
    newSocket.on("roundEnd", onRoundEnd);
    newSocket.on("timeUpdate", onTimeUpdate);
    newSocket.on("gameEnd", onGameEnd);
    newSocket.on("gameCancelled", onGameCancelled);
    newSocket.on("gameError", onGameError);
    newSocket.on("systemMessage", onSystemMessage);

    // --- Cleanup Function ---
    return () => {
      console.log(`(Effect Cleanup) Cleaning up socket: ${newSocket.id}`);
      newSocket.off("connect", handleConnect);
      newSocket.off("disconnect", handleDisconnect);
      newSocket.off("connect_error", handleConnectError);
      newSocket.off("roomCreated");
      newSocket.off("joinedRoom");
      newSocket.off("joinError");
      newSocket.off("playersUpdate");
      newSocket.off("gameStarted");
      newSocket.off("startDrawing");
      newSocket.off("guessUpdate");
      newSocket.off("draw");
      newSocket.off("roundEnd");
      newSocket.off("timeUpdate");
      newSocket.off("gameEnd");
      newSocket.off("gameCancelled");
      newSocket.off("gameError");
      newSocket.off("systemMessage");
      newSocket.disconnect();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
        setIsConnected(false);
        setIsJoined(false);
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [address, contractOwner]); // Dependency includes contractOwner for game end auto-declare logic

  // --- Contract Interaction Functions ---
  const handleDeposit = async () => {
    if (!roomId) {
      toast.error("No Room ID.");
      return;
    }
    if (!address) {
      toast.error("Connect wallet.");
      return;
    }
    if (chainId !== TARGET_CHAIN_ID) {
      toast.error(`Switch to Base Sepolia (ID ${TARGET_CHAIN_ID}).`);
      return;
    }
    if (userBalance && userBalance.value < DEPOSIT_AMOUNT_WEI) {
      toast.error(`Insufficient ETH.`);
      return;
    }
    try {
      setIsDepositPending(true);
      toast.info("Confirm deposit...");
      const hash = await writeContractAsync({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "deposit",
        args: [roomId],
        value: DEPOSIT_AMOUNT_WEI,
        chainId: TARGET_CHAIN_ID,
      });
      setDepositHash(hash);
      toast.loading("Processing deposit...", { id: "deposit-toast" });
    } catch (error: any) {
      console.error("Deposit error:", error);
      toast.error(`Deposit failed: ${error.shortMessage || "Tx failed."}`);
      setIsDepositPending(false);
    } finally {
      toast.dismiss("deposit-toast");
    }
  };
  const declareGameWinner = async (winnerAddress: string) => {
    if (!address || !contractOwner || !isAddressEqual(address, contractOwner))
      return;
    if (
      !roomId ||
      !winnerAddress ||
      winnerAddress === "0x0000000000000000000000000000000000000000"
    )
      return;
    if (chainId !== TARGET_CHAIN_ID) {
      toast.error(`Switch network.`);
      return;
    }
    if (
      roomInfo &&
      roomInfo[2] !== "0x0000000000000000000000000000000000000000"
    ) {
      return;
    }
    if (declareWinnerResult.isLoading) return;
    try {
      toast.info("Confirm declare winner...");
      console.log([roomId, winnerAddress as `0x${string}`]);
      const hash = await writeContractAsync({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "declareWinner",
        args: [roomId, winnerAddress as `0x${string}`],
        chainId: TARGET_CHAIN_ID,
        account: privateKeyToAccount(
          process.env.NEXT_PUBLIC_PRIVY_PRIVATE_KEY as `0x${string}`
        ),
      });
      setDeclareWinnerHash(hash);
      toast.loading("Declaring winner...", { id: "declare-winner-toast" });
    } catch (error: any) {
      console.error("Declare winner error:", error);
      toast.error(`Declare winner fail: ${error.shortMessage || "Tx failed."}`);
    } finally {
      toast.dismiss("declare-winner-toast");
    }
  };
  const withdrawWinnings = async () => {
    const declaredWinnerOnChain = roomInfo?.[2];
    if (
      !address ||
      !declaredWinnerOnChain ||
      !isAddressEqual(address, declaredWinnerOnChain)
    )
      return;
    if (!roomId || !roomInfo || Number(roomInfo[1]) === 0) return;
    if (chainId !== TARGET_CHAIN_ID) {
      toast.error(`Switch network.`);
      return;
    }
    if (withdrawResult.isLoading) return;
    try {
      toast.info("Confirm withdrawal...");
      const hash = await writeContractAsync({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "withdraw",
        args: [roomId],
        chainId: TARGET_CHAIN_ID,
      });
      setWithdrawHash(hash);
      toast.loading("Processing withdrawal...", { id: "withdraw-toast" });
    } catch (error: any) {
      console.error("Withdraw error:", error);
      toast.error(`Withdraw fail: ${error.shortMessage || "Tx failed."}`);
    } finally {
      toast.dismiss("withdraw-toast");
    }
  };

  // --- Room Management Functions ---
  const createRoom = () => {
    if (!isConnected || !socketRef.current || !address) {
      toast.error(isConnected ? "Connect wallet" : "Connecting...");
      return;
    }
    toast.info("Creating room...");
    socketRef.current.emit("createRoom", { username: address });
  };
  const joinRoomAfterDeposit = () => {
    if (!isConnected || !socketRef.current) {
      toast.error("Connecting...");
      setIsJoiningRoom(false);
      return;
    }
    if (
      !roomId ||
      !address ||
      hasDeposited !== true ||
      isJoined ||
      isJoiningRoom
    ) {
      setIsJoiningRoom(false);
      return;
    }
    console.log(`Emitting 'joinRoom': ${roomId}/${address}`);
    setIsJoiningRoom(true);
    setJoinError(null);
    socketRef.current.emit("joinRoom", { roomId, username: address });
  };
  const startGame = () => {
    if (
      !isAdmin ||
      !isConnected ||
      !socketRef.current ||
      !roomId ||
      players.length < MIN_PLAYERS_PER_ROOM
    )
      return;
    socketRef.current.emit("startGame", { roomId });
  };

  // --- Canvas & Guessing Functions ---
  const clearCanvas = () => {
    if (canvasRef.current)
      canvasRef.current
        .getContext("2d")
        ?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };
  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    // Check if drawing is allowed for the user
    if (
      !address ||
      !currentDrawer ||
      !isAddressEqual(address, currentDrawer) ||
      !canvasRef.current
    )
      return;

    isDrawingRef.current = true; // <<< Use ref to set drawing state
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    socketRef.current?.emit("draw", { roomId, x, y, type: "start" });
  };
  const stopDrawing = () => {
    if (isDrawingRef.current) {
      // <<< Use ref to check drawing state
      isDrawingRef.current = false;
      // Optional: could emit a "stop" event if useful for interpolation on receiving side
      // socketRef.current?.emit("draw", { roomId, type: "stop" });
    }
  };
  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current || !canvasRef.current || !roomId) return; // <<< Use ref to check state

    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    socketRef.current?.emit("draw", { roomId, x, y, type: "draw" });
    drawOnCanvas(x, y, "draw"); // Draw locally immediately
  };
  const drawOnCanvas = (x: number, y: number, type: string) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "black";
    if (type === "start") {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else if (type === "draw") {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };
  const submitGuess = () => {
    const userIsCurrentDrawer =
      address && currentDrawer && isAddressEqual(address, currentDrawer);
    if (userIsCurrentDrawer) return;
    const trimmedGuess = guessInput.trim();
    if (isConnected && socketRef.current && trimmedGuess && roomId && address) {
      socketRef.current.emit("guess", {
        roomId,
        guess: trimmedGuess,
        username: address,
      });
      setGuessInput("");
    } else if (!isConnected) toast.error("Connecting...");
  };
  const copyGameLink = () => {
    if (gameLink) {
      navigator.clipboard.writeText(gameLink);
      toast.success("Link copied!");
    }
  };

  // --- Main Render Logic ---

  if (!authenticated)
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6 shadow-md">
          <CardHeader>
            <CardTitle className="text-center">Connect Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-gray-600">Connect wallet to play!</p>
            <WalletConnector />
          </CardContent>
        </Card>
      </div>
    );

  // Lobby Screen
  if (!isJoined && !gameStarted && !gameEnded && !gameCancelled) {
    const showDepositSection = !!roomId && hasDeposited !== null;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <Card className="w-full max-w-lg p-6 shadow-lg">
          <CardHeader>
            <CardTitle className="text-center text-2xl font-bold">
              Skribbl Lobby
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center border-b pb-3 mb-3">
              <p className="text-sm text-gray-600">Playing as:</p>
              <p className="font-mono font-semibold text-indigo-700">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </p>
              {contractOwner && (
                <p className="text-xs text-gray-500 mt-1">
                  {address && isAddressEqual(address, contractOwner)
                    ? "(You are Contract Owner)"
                    : `Owner: ${contractOwner.slice(0, 6)}...`}
                </p>
              )}
            </div>
            <Button
              onClick={createRoom}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={!!roomId || !isConnected}
            >
              {roomId && isAdmin ? (
                "Room Created (Deposit Below)"
              ) : !isConnected ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Create New Room"
              )}
            </Button>
            <div className="space-y-4 border-t pt-4">
              <p className="text-center text-sm font-medium text-gray-700">
                Or Join Room:
              </p>
              <Input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.trim())}
                className="w-full text-center font-mono"
                disabled={isAdmin && !!roomId}
              />
              {showDepositSection && (
                <div className="space-y-3 text-center pt-3 border-t mt-4">
                  {hasDeposited === null && (
                    <p className="text-sm text-gray-500 flex items-center justify-center">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking deposit...
                    </p>
                  )}
                  {hasDeposited === false && (
                    <>
                      <p className="text-sm text-red-600 font-medium">
                        Deposit{" "}
                        <span className="font-semibold">
                          {DEPOSIT_AMOUNT_ETH} ETH
                        </span>{" "}
                        required for{" "}
                        <span className="font-mono font-semibold">
                          {roomId}
                        </span>
                        .
                      </p>
                      <Button
                        onClick={handleDeposit}
                        disabled={
                          isDepositPending ||
                          depositResult.isLoading ||
                          !isConnected
                        }
                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                      >
                        {" "}
                        {isDepositPending || depositResult.isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          `Deposit ${DEPOSIT_AMOUNT_ETH} ETH`
                        )}{" "}
                      </Button>
                      {!isConnected && (
                        <p className="text-xs text-red-500 mt-1">
                          Waiting for connection...
                        </p>
                      )}
                    </>
                  )}
                  {hasDeposited === true && (
                    <>
                      <p className="text-sm text-green-600 font-medium">
                        Deposit confirmed for{" "}
                        <span className="font-mono font-semibold">
                          {roomId}
                        </span>
                        !
                      </p>
                      <Button
                        onClick={joinRoomAfterDeposit}
                        variant="default"
                        className="w-full"
                        disabled={isJoiningRoom || !isConnected}
                      >
                        {" "}
                        {isJoiningRoom ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Entering...
                          </>
                        ) : !isConnected ? (
                          "Connecting..."
                        ) : (
                          "Enter Waiting Room"
                        )}{" "}
                      </Button>
                    </>
                  )}
                </div>
              )}
              {!roomId && (
                <p className="text-center text-xs text-gray-400 mt-2">
                  Enter Room ID to join.
                </p>
              )}
            </div>
            {roomId && roomInfo && (
              <div className="mt-4 text-xs border-t pt-3 text-gray-600">
                <h3 className="text-sm font-semibold mb-1 text-center">
                  On-Chain Info (<span className="font-mono">{roomId}</span>):
                </h3>
                <p>Deposits Recorded: {roomInfo[0].length}</p>
                <p>Total Pool: {formatEther(roomInfo[1])} ETH</p>
                <p>
                  Winner Declared:{" "}
                  {roomInfo[2] !== "0x0000000000000000000000000000000000000000"
                    ? `${roomInfo[2].slice(0, 6)}...`
                    : "Not Yet"}
                </p>
              </div>
            )}
            <Dialog open={!!joinError} onOpenChange={() => setJoinError(null)}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Join Error</DialogTitle>
                </DialogHeader>
                <div className="text-center py-4">
                  <p>{joinError}</p>
                </div>
                <Button
                  onClick={() => setJoinError(null)}
                  className="mt-4 w-full"
                >
                  OK
                </Button>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Waiting Room Screen
  if (isJoined && !gameStarted && !gameEnded && !gameCancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-100 to-purple-100 p-4">
        <Card className="w-full max-w-lg p-6 shadow-xl bg-white">
          <CardHeader>
            <CardTitle className="text-center text-2xl font-bold text-gray-800">
              Waiting Room
            </CardTitle>
            <p className="text-center text-sm text-gray-500 font-mono">
              {roomId}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {isAdmin && gameLink && (
              <div className="space-y-2 border-b pb-4">
                <p className="text-sm font-medium text-center text-gray-700">
                  Invite link:
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={gameLink}
                    readOnly
                    className="flex-1 bg-gray-100 border-gray-300 text-sm"
                  />
                  <Button onClick={copyGameLink} variant="outline" size="icon">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-lg font-semibold mb-2 text-center text-gray-700">
                Players ({players.length}/{MAX_PLAYERS_PER_ROOM}):
              </h3>
              <div className="max-h-40 overflow-y-auto rounded-md border bg-gray-50 p-3">
                <ul className="list-none space-y-1 text-center">
                  {players.length === 0 && (
                    <p className="text-sm text-gray-500 italic">Waiting...</p>
                  )}
                  {players
                    .filter((player) => !!player)
                    .map((player) => (
                      <li
                        key={player}
                        className="text-sm font-mono py-1 px-2 rounded hover:bg-gray-200"
                      >
                        {" "}
                        {player.slice(0, 8)}...{player.slice(-6)}{" "}
                        {address &&
                          isAdmin &&
                          isAddress(player) &&
                          isAddressEqual(player, address) && (
                            <span className="text-xs text-indigo-600 font-semibold ml-1">
                              (Admin)
                            </span>
                          )}{" "}
                        {address &&
                          !isAdmin &&
                          isAddress(player) &&
                          isAddressEqual(player, address) && (
                            <span className="text-xs text-green-600 font-semibold ml-1">
                              (You)
                            </span>
                          )}{" "}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
            {roomInfo && (
              <div className="text-center text-sm text-gray-600 border-t pt-4">
                <p>
                  Pool:{" "}
                  <span className="font-semibold text-lg text-emerald-600">
                    {formatEther(roomInfo[1])} ETH
                  </span>
                </p>
              </div>
            )}
            {isAdmin && (
              <Button
                onClick={startGame}
                disabled={!isConnected || players.length < MIN_PLAYERS_PER_ROOM}
                className="w-full text-lg py-3 bg-green-500 hover:bg-green-600 text-white shadow-md"
              >
                {" "}
                {!isConnected ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : players.length < MIN_PLAYERS_PER_ROOM ? (
                  `Waiting (${players.length}/${MIN_PLAYERS_PER_ROOM})`
                ) : (
                  "Start Game!"
                )}{" "}
              </Button>
            )}
            {!isAdmin && (
              <p className="text-center font-semibold text-indigo-600 animate-pulse">
                Waiting for admin (
                {players[0] ? `${players[0].slice(0, 6)}...` : "..."}) to
                start...
              </p>
            )}
          </CardContent>
        </Card>
        <WalletConnector />
      </div>
    );
  }

  // Game Cancelled Screen
  if (gameCancelled)
    return (
      <div className="flex min-h-screen items-center justify-center bg-red-100 p-4">
        <Card className="w-full max-w-md p-6 text-center shadow-lg bg-white">
          <CardHeader>
            <CardTitle className="text-red-600 text-2xl">
              Game Cancelled
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-700">
              Room <span className="font-mono">{roomId}</span> cancelled.
            </p>
            <Button
              onClick={() => (window.location.href = "/")}
              variant="outline"
              className="mt-4 w-full"
            >
              Back to Lobby
            </Button>
          </CardContent>
        </Card>
      </div>
    );

  // Game Over Screen
  if (gameEnded) {
    const winnerAddress = gameWinner ? (gameWinner as `0x${string}`) : null;
    const winnerDeclaredOnChain =
      roomInfo && roomInfo[2] !== "0x0000000000000000000000000000000000000000";
    const declaredWinnerAddress = winnerDeclaredOnChain ? roomInfo[2] : null;
    const connectedUserIsDeclaredWinner =
      address &&
      declaredWinnerAddress &&
      isAddressEqual(address, declaredWinnerAddress);
    const connectedUserIsOwner =
      address && contractOwner && isAddressEqual(address, contractOwner);
    const canWithdraw =
      connectedUserIsDeclaredWinner && roomInfo && Number(roomInfo[1]) > 0;
    const connectedUserIsGameWinner =
      address && winnerAddress && isAddressEqual(address, winnerAddress);
    return (
      <Dialog
        open={gameEnded}
        onOpenChange={(open) => !open && setGameEnded(false)}
      >
        <DialogContent className="sm:max-w-lg bg-gradient-to-br from-green-50 to-blue-50">
          <DialogHeader>
            <DialogTitle className="text-3xl text-center font-bold text-gray-800 pt-4">
              Game Over!
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-4 pb-6 px-6">
            <p className="text-xl text-center font-semibold text-indigo-700">
              Winner:{" "}
              {winnerAddress
                ? `${winnerAddress.slice(0, 6)}...${winnerAddress.slice(-4)}`
                : "N/A"}
            </p>
            <div>
              <h3 className="text-lg font-semibold mb-2 text-center text-gray-700">
                Final Scores:
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-md border bg-white p-3 text-sm">
                <ul className="list-none space-y-1 text-center">
                  {Object.entries(scores)
                    .sort(([, a], [, b]) => b - a)
                    .map(([p, s]) => (
                      <li
                        key={p}
                        className={`font-mono py-1 px-2 rounded ${
                          winnerAddress &&
                          isAddress(p) &&
                          isAddressEqual(p, winnerAddress)
                            ? "bg-green-100 font-bold"
                            : ""
                        }`}
                      >
                        {p.slice(0, 8)}...{p.slice(-6)}: {s} pts
                      </li>
                    ))}
                </ul>
              </div>
            </div>
            <div className="border-t pt-4 space-y-3">
              {connectedUserIsOwner &&
                winnerAddress &&
                !winnerDeclaredOnChain && (
                  <Button
                    onClick={() => declareGameWinner(winnerAddress)}
                    disabled={declareWinnerResult.isLoading}
                    className="w-full"
                  >
                    {declareWinnerResult.isLoading ? (
                      <>...</>
                    ) : (
                      "Declare Winner"
                    )}
                  </Button>
                )}
              {connectedUserIsOwner && winnerDeclaredOnChain && (
                <p className="text-center text-xs text-gray-500">
                  Winner (
                  <span className="font-mono">
                    {declaredWinnerAddress?.slice(0, 6)}...
                  </span>
                  ) declared.
                </p>
              )}
              {canWithdraw && (
                <Button
                  onClick={withdrawWinnings}
                  disabled={withdrawResult.isLoading}
                  className="w-full"
                >
                  {withdrawResult.isLoading ? (
                    <>...</>
                  ) : (
                    `Withdraw ${formatEther(roomInfo[1])} ETH`
                  )}
                </Button>
              )}
              {connectedUserIsGameWinner && !winnerDeclaredOnChain && (
                <p className="text-center text-sm text-orange-600">
                  Waiting for owner.
                </p>
              )}
              {connectedUserIsDeclaredWinner &&
                roomInfo &&
                Number(roomInfo[1]) === 0 && (
                  <p className="text-center text-sm text-gray-600">
                    Withdrawn.
                  </p>
                )}
            </div>
            <Button
              onClick={() => (window.location.href = "/")}
              variant="outline"
              className="w-full mt-4"
            >
              Play Again
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Main Game Screen
  if (isJoined && gameStarted) {
    const userIsDrawer =
      address && currentDrawer && isAddressEqual(address, currentDrawer);
    return (
      <div className="min-h-screen bg-gray-100 p-2 md:p-4 flex justify-center relative">
        <div className="flex flex-col lg:flex-row gap-4 w-full max-w-7xl">
          <Card className="w-full lg:w-1/4 lg:max-w-xs order-2 lg:order-1 shadow-md">
            <CardHeader className="p-3 bg-gray-50">
              <CardTitle className="text-lg font-semibold text-center">
                Players
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                {players.map((player) => (
                  <li
                    key={player}
                    className={`text-sm p-1.5 rounded ${
                      isAddressEqual(player, currentDrawer)
                        ? "bg-blue-100 font-semibold"
                        : ""
                    }`}
                  >
                    <span className="font-mono">
                      {player.slice(0, 6)}...{player.slice(-4)}
                    </span>
                    {isAddressEqual(player, currentDrawer) && (
                      <span className="text-xs ml-1">(Drawing)</span>
                    )}
                    <span className="float-right font-medium">
                      {scores[player.toLowerCase()] || 0} pts
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="w-full lg:flex-1 order-1 lg:order-2 space-y-3">
            <Card className="shadow-lg">
              <CardHeader className="p-3 bg-white border-b">
                <CardTitle className="text-base font-medium flex flex-wrap justify-center items-center gap-x-3 gap-y-1">
                  <span>
                    R {round}/{maxRounds}
                  </span>
                  <span>|</span>
                  <span>
                    T:{" "}
                    <span
                      className={`font-bold ${
                        timeLeft < 10 ? "text-red-500" : ""
                      }`}
                    >
                      {timeLeft}s
                    </span>
                  </span>
                  <span>|</span>
                  <span className="w-full md:w-auto text-center">
                    {userIsDrawer ? "Your Word:" : "Guess:"}
                    <span className="font-bold text-xl ml-2">{word}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-1 bg-white">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={450}
                  className={`w-full h-auto aspect-video border ${
                    userIsDrawer ? "cursor-crosshair bg-white" : "bg-gray-50"
                  }`}
                  style={{ touchAction: "none" }}
                  onMouseDown={startDrawing}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onMouseMove={draw}
                  onTouchStart={startDrawing}
                  onTouchEnd={stopDrawing}
                  onTouchMove={draw}
                />
              </CardContent>
            </Card>
            <div className="flex gap-2">
              <Input
                type="text"
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitGuess()}
                placeholder={userIsDrawer ? "Drawing..." : "Guess..."}
                disabled={userIsDrawer || !isConnected}
                className="flex-1"
                maxLength={50}
              />
              <Button
                onClick={submitGuess}
                disabled={userIsDrawer || !guessInput.trim() || !isConnected}
                className="bg-green-500"
              >
                Guess
              </Button>
            </div>
          </div>
          <Card className="w-full lg:w-1/4 lg:max-w-xs order-3 shadow-md">
            <CardHeader className="p-3 bg-gray-50">
              <CardTitle className="text-lg font-semibold text-center">
                Guesses
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 h-[calc(60vh+40px)] flex flex-col">
              <div className="flex-grow overflow-y-auto space-y-1.5 text-sm border p-2 bg-white">
                {guesses.length === 0 && (
                  <p className="text-gray-400 text-xs italic text-center">
                    ...
                  </p>
                )}
                {guesses.map((g, i) => (
                  <div key={i} className="break-words text-xs">
                    {g}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="fixed bottom-4 right-4 z-50">
          <WalletConnector />
        </div>
      </div>
    );
  }

  // Fallback Loading
  return (
    <div className="flex min-h-screen items-center justify-center text-gray-500">
      <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading...
      <WalletConnector />
    </div>
  );
}
