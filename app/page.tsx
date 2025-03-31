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
} from "@/components/ui/dialog";
import WalletConnector from "@/components/wallet-connector";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { privateKeyToAccount } from "viem/accounts";

const ESCROW_CONTRACT_ADDRESS =
  "0xA4aD27A37B6e73756b95bA73b605329a39Bf3CF1" as `0x${string}`;
const DEPOSIT_AMOUNT = "0.0005"; // Fixed deposit amount in ETH

const ESCROW_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "roomId", type: "string" }],
    outputs: [],
  },
  {
    name: "startGame",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roomId", type: "string" }],
    outputs: [],
  },
  {
    name: "declareWinner",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId", type: "string" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roomId", type: "string" }],
    outputs: [],
  },
  {
    name: "getRoomInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roomId", type: "string" }],
    outputs: [
      { name: "players", type: "address[]" },
      { name: "totalDeposited", type: "uint256" },
      { name: "gameActive", type: "bool" },
      { name: "winner", type: "address" },
    ],
  },
  {
    name: "deposits",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "roomId", type: "string" },
      { name: "player", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export default function Home() {
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [isPublicGame, setIsPublicGame] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [word, setWord] = useState("");
  const [currentDrawer, setCurrentDrawer] = useState("");
  const [guesses, setGuesses] = useState<string[]>([]);
  const [guessInput, setGuessInput] = useState("");
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(3);
  const [gameEnded, setGameEnded] = useState(false);
  const [gameWinner, setGameWinner] = useState("");
  const [timeLeft, setTimeLeft] = useState<number>(90);
  const [isAdmin, setIsAdmin] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [roundStartTime, setRoundStartTime] = useState<number>(0);
  const [bufferTimeLeft, setBufferTimeLeft] = useState<number | null>(null);
  const [gameCancelled, setGameCancelled] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isDepositPending, setIsDepositPending] = useState(false);
  const [depositHash, setDepositHash] = useState<`0x${string}` | undefined>();
  const [startGameHash, setStartGameHash] = useState<
    `0x${string}` | undefined
  >();
  const [declareWinnerHash, setDeclareWinnerHash] = useState<
    `0x${string}` | undefined
  >();
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | undefined>();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  let isDrawing = false;

  // Contract hooks
  const { writeContract } = useWriteContract();

  const { data: userDeposit } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "deposits",
    args: [roomId || "", address!],
    query: {
      enabled: !!address && !!roomId,
    },
  });

  const { data: roomInfo } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getRoomInfo",
    args: [roomId],
    query: {
      enabled: !!roomId,
    },
  });

  const { data: contractOwner } = useReadContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "owner",
    query: {
      enabled: !!address,
    },
  });

  const depositResult = useWaitForTransactionReceipt({ hash: depositHash });
  const startGameResult = useWaitForTransactionReceipt({ hash: startGameHash });
  const declareWinnerResult = useWaitForTransactionReceipt({
    hash: declareWinnerHash,
  });
  const withdrawResult = useWaitForTransactionReceipt({ hash: withdrawHash });

  // Handle transaction success states with useEffect
  useEffect(() => {
    if (depositResult.isSuccess) {
      setIsDepositPending(false);
      setDepositHash(undefined);
    }
  }, [depositResult.isSuccess]);

  useEffect(() => {
    if (startGameResult.isSuccess) {
      setStartGameHash(undefined);
    }
  }, [startGameResult.isSuccess]);

  useEffect(() => {
    if (declareWinnerResult.isSuccess) {
      setDeclareWinnerHash(undefined);
    }
  }, [declareWinnerResult.isSuccess]);

  useEffect(() => {
    if (withdrawResult.isSuccess) {
      setWithdrawHash(undefined);
    }
  }, [withdrawResult.isSuccess]);

  // Handle deposit with fixed amount
  const handleDeposit = async () => {
    try {
      setIsDepositPending(true);
      const ethInWei = parseEther(DEPOSIT_AMOUNT);

      const hash = await writeContract({
        address: ESCROW_CONTRACT_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "deposit",
        args: [roomId],
        value: ethInWei,
      });

      setDepositHash(hash as any);
    } catch (error) {
      console.error("Deposit failed:", error);
      setIsDepositPending(false);
    }
  };

  // Start game
  const startGame = async () => {
    if (isAdmin && roomId) {
      try {
        const hash = await writeContract({
          address: ESCROW_CONTRACT_ADDRESS,
          abi: ESCROW_ABI,
          functionName: "startGame",
          args: [roomId],
        });

        setStartGameHash(hash as any);
        socket?.emit("startGame", { roomId });
      } catch (error) {
        console.error("Failed to start game:", error);
      }
    }
  };

  // Declare winner (only owner)
  const declareGameWinner = async (winnerAddress: string) => {
    if (address !== contractOwner) {
      console.error("Only the contract owner can declare the winner");
      return;
    }
    if (roomId) {
      try {
        const hash = await writeContract({
          address: ESCROW_CONTRACT_ADDRESS,
          abi: ESCROW_ABI,
          functionName: "declareWinner",
          args: [roomId, winnerAddress as `0x${string}`],
          account: privateKeyToAccount(
            process.env.NEXT_PUBLIC_PRIVATE_KEY as `0x${string}`
          ),
        });

        setDeclareWinnerHash(hash as any);
      } catch (error) {
        console.error("Failed to declare winner:", error);
      }
    }
  };

  // Withdraw winnings
  const withdrawWinnings = async () => {
    if (roomId && address === gameWinner) {
      try {
        const hash = await writeContract({
          address: ESCROW_CONTRACT_ADDRESS,
          abi: ESCROW_ABI,
          functionName: "withdraw",
          args: [roomId],
        });

        setWithdrawHash(hash as any);
      } catch (error) {
        console.error("Failed to withdraw:", error);
      }
    }
  };

  useEffect(() => {
    const socketUrl =
      process.env.NODE_ENV === "development"
        ? "ws://localhost:3001"
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
            window.location.host
          }:3001`;
    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to WebSocket server");
      if (isJoined && roomId) {
        if (isPublicGame) {
          newSocket.emit("joinPublicGame", { username: address });
        } else {
          newSocket.emit("joinRoom", { roomId, username: address });
        }
      }
    });

    newSocket.on("disconnect", () => {
      console.log("Disconnected from WebSocket server");
      if (timerRef.current) clearInterval(timerRef.current);
    });

    newSocket.on("reconnect", () => {
      console.log("Reconnected to WebSocket server");
      if (isJoined && roomId) {
        if (isPublicGame) {
          newSocket.emit("joinPublicGame", { username: address });
        } else {
          newSocket.emit("joinRoom", { roomId, username: address });
        }
      }
    });

    newSocket.on("joinedPublicGame", ({ roomId }) => {
      setRoomId(roomId);
      setBufferTimeLeft(60);
      const bufferInterval = setInterval(() => {
        setBufferTimeLeft((prev) => (prev && prev > 0 ? prev - 1 : 0));
      }, 1000);
      setTimeout(() => clearInterval(bufferInterval), 60 * 1000);
    });

    newSocket.on("gameCancelled", (message) => {
      setGameCancelled(true);
      alert(message);
    });

    newSocket.on("joinError", (message: string) => {
      setJoinError(message);
      setIsJoined(false);
      console.log(`Join error: ${message}`);
    });

    newSocket.on("playersUpdate", ({ players, scores, admin }) => {
      setPlayers(players);
      setScores(scores);
      setIsAdmin(admin === address);
    });

    newSocket.on("gameStarted", () => {
      setGameStarted(true);
      setBufferTimeLeft(null);
    });

    newSocket.on("startDrawing", ({ drawer, word, round, maxRounds, time }) => {
      setCurrentDrawer(drawer);
      setWord(drawer === address ? word : "_".repeat(word.length));
      setRound(round);
      setMaxRounds(maxRounds);
      setGuesses([]);
      setTimeLeft(time ?? 90);
      setRoundStartTime(Date.now());
      clearCanvas();

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - roundStartTime;
        const timeLeft = Math.max(0, Math.round((90 * 1000 - elapsed) / 1000));
        setTimeLeft(timeLeft);
        if (timeLeft <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }, 1000);
    });

    newSocket.on("guessUpdate", (guess: string) => {
      setGuesses((prev) => [...prev, guess]);
    });

    newSocket.on("draw", ({ x, y, type }) => {
      drawOnCanvas(x, y, type);
    });

    newSocket.on("roundEnd", ({ winner, word, scores }) => {
      setWord(word);
      setScores(scores);
      setTimeLeft(0);
      if (timerRef.current) clearInterval(timerRef.current);
      let alertMessage = `${winner} guessed correctly! Word was: ${word}`;
      if (winner !== "Time's up! No one") {
        const guesserScore =
          scores[winner] - (scores[winner] - (scores[winner] % 1000));
        const drawerScore =
          scores[currentDrawer] -
          (scores[currentDrawer] - (scores[currentDrawer] % 500));
        alertMessage += `\n${winner} earned ${guesserScore} points!\n${currentDrawer} (drawer) earned ${drawerScore} points!`;
      } else {
        alertMessage += `\nNo points awarded. Drawer loses 50 points.`;
      }
      alert(alertMessage);
    });

    newSocket.on("timeUpdate", (time: number) => {
      setTimeLeft(time ?? 90);
      setRoundStartTime(Date.now() - (90 - time) * 1000);
    });

    newSocket.on("gameEnd", async ({ scores, winner }) => {
      setScores(scores);
      setGameWinner(winner);
      setGameEnded(true);
      if (timerRef.current) clearInterval(timerRef.current);
      if (address === contractOwner) {
        await declareGameWinner(winner);
      }
    });

    return () => {
      newSocket.disconnect();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [
    currentDrawer,
    isJoined,
    roomId,
    address,
    isPublicGame,
    isAdmin,
    contractOwner,
  ]);

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
  };

  const joinPublicGame = () => {
    if (socket && address) {
      const publicRoomId = `public_${Date.now()}`;
      setRoomId(publicRoomId);

      if (!userDeposit || userDeposit === BigInt(0)) {
        alert(`Please deposit ${DEPOSIT_AMOUNT} ETH to join the game`);
        return;
      }

      socket.emit("joinPublicGame", { username: address });
      setIsJoined(true);
      setIsPublicGame(true);
    }
  };

  const joinPrivateRoom = () => {
    if (!userDeposit || userDeposit === BigInt(0)) {
      alert(`Please deposit ${DEPOSIT_AMOUNT} ETH to join the game`);
      return;
    }
    if (socket && roomId && address) {
      socket.emit("joinRoom", { roomId, username: address });
      setIsJoined(true);
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (address !== currentDrawer || !canvasRef.current) return;
    isDrawing = true;
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.beginPath();
      ctx.moveTo(x, y);
      socket?.emit("draw", { roomId, x, y, type: "start" });
    }
  };

  const stopDrawing = () => {
    isDrawing = false;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !socket || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    socket.emit("draw", { roomId, x, y, type: "draw" });
    drawOnCanvas(x, y, "draw");
  };

  const drawOnCanvas = (x: number, y: number, type: string) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (type === "start") {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else if (type === "draw") {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const submitGuess = () => {
    if (socket && guessInput) {
      socket.emit("guess", { roomId, guess: guessInput, username: address });
      setGuessInput("");
    }
  };

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-gray-600">
              Please connect your wallet to continue
            </p>
            <WalletConnector />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>Join a Game</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-gray-600">
              Playing as: {address?.slice(0, 6)}...{address?.slice(-4)}
            </p>
            {contractOwner && (
              <p className="text-center text-sm text-gray-600">
                Contract Owner: {contractOwner.slice(0, 6)}...
                {contractOwner.slice(-4)}
              </p>
            )}

            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full"
              />

              {(!userDeposit || userDeposit === BigInt(0)) && roomId && (
                <div className="space-y-2">
                  <p className="text-center text-sm text-gray-600">
                    Deposit {DEPOSIT_AMOUNT} ETH to play in this room
                  </p>
                  <Button
                    onClick={handleDeposit}
                    disabled={isDepositPending || depositResult.isLoading}
                    className="w-full"
                  >
                    {isDepositPending || depositResult.isLoading
                      ? "Depositing..."
                      : "Deposit to Play"}
                  </Button>
                </div>
              )}

              {userDeposit && userDeposit > BigInt(0) && (
                <>
                  <Button
                    onClick={joinPrivateRoom}
                    variant="outline"
                    className="w-full"
                  >
                    Join Private Room
                  </Button>
                  <Button onClick={joinPublicGame} className="w-full">
                    Join Public Game (10 AM / 10 PM IST)
                  </Button>
                </>
              )}
            </div>

            {roomInfo && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">Room Info:</h3>
                <p className="text-sm">Players: {roomInfo[0].length}</p>
                <p className="text-sm">
                  Total Deposited: {formatEther(roomInfo[1])} ETH
                </p>
                <p className="text-sm">
                  Game Active: {roomInfo[2] ? "Yes" : "No"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!joinError} onOpenChange={() => setJoinError(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Error</DialogTitle>
            </DialogHeader>
            <div className="text-center">
              <p>{joinError}</p>
            </div>
            <Button onClick={() => setJoinError(null)} className="mt-4">
              OK
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (isPublicGame && bufferTimeLeft !== null && bufferTimeLeft > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>
              Public Game Starting in {bufferTimeLeft} seconds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">FAQ / Rules</h3>
              <ul className="list-disc pl-5 text-sm">
                <li>Game starts at 10:01 AM/PM IST</li>
                <li>3 rounds, 10 players max per room</li>
                <li>Guess the word drawn by the current player</li>
                <li>Earn points for correct guesses!</li>
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Players Joined:</h3>
              <ul className="list-disc pl-5">
                {players.map((player) => (
                  <li key={player}>
                    {player.slice(0, 6)}...{player.slice(-4)}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameCancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>Game Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Not enough players joined. Try again at the next public game!</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameEnded) {
    return (
      <Dialog open={gameEnded}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Game Over!</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-lg">Winner: {gameWinner}</p>
            <h3 className="text-lg font-semibold">Final Scores:</h3>
            <ul className="list-disc pl-5">
              {Object.entries(scores).map(([player, score]) => (
                <li key={player}>
                  {player.slice(0, 6)}...{player.slice(-4)}: {score}
                </li>
              ))}
            </ul>
            {address === contractOwner && (
              <Button
                onClick={() => declareGameWinner(gameWinner)}
                disabled={declareWinnerResult.isLoading}
              >
                {declareWinnerResult.isLoading
                  ? "Declaring Winner..."
                  : "Declare Winner on Blockchain"}
              </Button>
            )}
            {address === gameWinner && roomInfo && !roomInfo[2] && (
              <Button
                onClick={withdrawWinnings}
                disabled={withdrawResult.isLoading}
              >
                {withdrawResult.isLoading
                  ? "Withdrawing..."
                  : `Withdraw ${formatEther(roomInfo[1])} ETH`}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!gameStarted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>Waiting for the game to start...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Players in Room:</h3>
              <ul className="list-disc pl-5">
                {players.map((player) => (
                  <li key={player}>
                    {player.slice(0, 6)}...{player.slice(-4)}{" "}
                    {player === address && isAdmin && "(Admin)"}
                  </li>
                ))}
              </ul>
            </div>
            {roomInfo && (
              <div>
                <p>Total Deposited: {formatEther(roomInfo[1])} ETH</p>
                <p>Players: {roomInfo[0].length}</p>
              </div>
            )}
            {isAdmin && (
              <Button
                onClick={startGame}
                disabled={startGameResult.isLoading}
                className="w-full"
              >
                {startGameResult.isLoading ? "Starting..." : "Start Game"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <WalletConnector />
      <div className="flex flex-col md:flex-row gap-6 max-w-7xl mx-auto">
        <Card className="w-full md:w-1/4">
          <CardHeader>
            <CardTitle>Players</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {players.map((player) => (
                <li key={player} className="text-sm">
                  {player.slice(0, 6)}...{player.slice(-4)} -{" "}
                  {scores[player] || 0} pts
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="w-full md:w-3/4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                Round {round}/{maxRounds} - Word: {word} - Time: {timeLeft}s
              </CardTitle>
            </CardHeader>
            <CardContent>
              <canvas
                ref={canvasRef}
                width={800}
                height={400}
                className="w-full border rounded-md"
                onMouseDown={startDrawing}
                onMouseUp={stopDrawing}
                onMouseMove={draw}
              />
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Input
              type="text"
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="Your guess"
              disabled={address === currentDrawer}
              className="flex-1"
            />
            <Button
              onClick={submitGuess}
              disabled={address === currentDrawer}
              className="bg-green-500 hover:bg-green-600"
            >
              Guess
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Guesses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {guesses.map((guess, i) => (
                  <div key={i} className="text-sm">
                    {guess}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
