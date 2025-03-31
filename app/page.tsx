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
import { useSearchParams } from 'next/navigation';

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
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
  const [gameLink, setGameLink] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  let isDrawing = false;

  const searchParams = useSearchParams();

  useEffect(() => {
    // Check for room ID in URL
    const roomIdFromUrl = searchParams.get('room');
    if (roomIdFromUrl) {
      setRoomId(roomIdFromUrl);
    }
  }, [searchParams]);

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
        newSocket.emit("joinRoom", { roomId, username });
      }
    });

    newSocket.on("disconnect", () => {
      console.log("Disconnected from WebSocket server");
      if (timerRef.current) clearInterval(timerRef.current);
    });

    newSocket.on("reconnect", () => {
      console.log("Reconnected to WebSocket server");
      if (isJoined && roomId) {
        newSocket.emit("joinRoom", { roomId, username });
      }
    });

    newSocket.on("roomCreated", ({ roomId }) => {
      setRoomId(roomId);
      setIsJoined(true);
      setIsAdmin(true);
      // Generate game link
      const link = `${window.location.origin}?room=${roomId}`;
      setGameLink(link);
      // Update URL without reloading
      window.history.pushState({}, '', link);
    });

    newSocket.on("joinError", (message: string) => {
      setJoinError(message);
      setIsJoined(false);
      console.log(`Join error: ${message}`);
    });

    newSocket.on("playersUpdate", ({ players, scores, admin }) => {
      console.log("playersUpdate received:", { players, scores, admin });
      setPlayers(players);
      setScores(scores);
      setIsAdmin(admin === username);
    });

    newSocket.on("gameStarted", () => {
      console.log("gameStarted received");
      setGameStarted(true);
      setBufferTimeLeft(null);
    });

    newSocket.on("startDrawing", ({ drawer, word, round, maxRounds, time }) => {
      console.log("startDrawing received:", {
        drawer,
        word,
        round,
        maxRounds,
        time,
      });
      setCurrentDrawer(drawer);
      setWord(drawer === username ? word : "_".repeat(word.length));
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
      console.log("guessUpdate received:", guess);
      setGuesses((prev) => [...prev, guess]);
    });

    newSocket.on("draw", ({ x, y, type }) => {
      console.log("draw event received:", { x, y, type });
      drawOnCanvas(x, y, type);
    });

    newSocket.on("roundEnd", ({ winner, word, scores }) => {
      console.log("roundEnd received:", { winner, word, scores });
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
      console.log("timeUpdate received:", time);
      setTimeLeft(time ?? 90);
      setRoundStartTime(Date.now() - (90 - time) * 1000);
    });

    newSocket.on("gameEnd", ({ scores, winner }) => {
      console.log("gameEnd received:", { scores, winner });
      setScores(scores);
      setGameWinner(winner);
      setGameEnded(true);
      if (timerRef.current) clearInterval(timerRef.current);
    });

    newSocket.on("gameCancelled", (message) => {
      setGameCancelled(true);
      alert(message);
    });

    return () => {
      newSocket.disconnect();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentDrawer, isJoined, roomId, username]);

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
  };

  const createRoom = () => {
    if (socket && username) {
      socket.emit("createRoom", { username });
    }
  };

  const joinPrivateRoom = () => {
    if (socket && roomId && username) {
      setIsJoined(true); // Set joined state before emitting join event
      socket.emit("joinRoom", { roomId, username });
    }
  };

  const startGame = () => {
    if (socket && isAdmin) {
      socket.emit("startGame", { roomId });
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (username !== currentDrawer || !canvasRef.current) return;
    isDrawing = true;
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.beginPath();
      ctx.moveTo(x, y);
      console.log("Emitting draw event (start):", {
        roomId,
        x,
        y,
        type: "start",
      });
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

    console.log("Emitting draw event (draw):", { roomId, x, y, type: "draw" });
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
      console.log("Emitting guess event:", {
        roomId,
        guess: guessInput,
        username,
      });
      socket.emit("guess", { roomId, guess: guessInput, username });
      setGuessInput("");
    }
  };

  const copyGameLink = () => {
    navigator.clipboard.writeText(gameLink);
    alert("Game link copied to clipboard!");
  };

  if (!isJoined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md p-6">
          <CardHeader>
            <CardTitle>Join or Create a Game</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full"
            />
            <Button onClick={createRoom} className="w-full">
              Create New Room
            </Button>
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full"
              />
              <Button
                onClick={joinPrivateRoom}
                variant="outline"
                className="w-full"
              >
                Join Existing Room
              </Button>
            </div>
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
                  <li key={player}>{player}</li>
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
                  {player}: {score}
                </li>
              ))}
            </ul>
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
            {isAdmin && (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Game Link:</p>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={gameLink}
                      readOnly
                      className="flex-1"
                    />
                    <Button onClick={copyGameLink} variant="outline">
                      Copy
                    </Button>
                  </div>
                </div>
                <Button onClick={startGame} className="w-full">
                  Start Game
                </Button>
              </>
            )}
            <div>
              <h3 className="text-lg font-semibold">Players in Room:</h3>
              <ul className="list-disc pl-5">
                {players.map((player) => (
                  <li key={player}>
                    {player} {player === username && isAdmin && "(Admin)"}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="flex flex-col md:flex-row gap-6 max-w-7xl mx-auto">
        <Card className="w-full md:w-1/4">
          <CardHeader>
            <CardTitle>Players</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {players.map((player) => (
                <li key={player} className="text-sm">
                  {player} {player === currentDrawer && "(Drawing)"} -{" "}
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
              disabled={username === currentDrawer}
              className="flex-1"
            />
            <Button
              onClick={submitGuess}
              disabled={username === currentDrawer}
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
