"use client";

import { useState, useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [isJoined, setIsJoined] = useState(false);
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  let isDrawing = false;

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

    newSocket.on("playersUpdate", ({ players, scores, admin }) => {
      console.log("playersUpdate received:", { players, scores, admin });
      setPlayers(players);
      setScores(scores);
      setIsAdmin(admin === username);
    });

    newSocket.on("gameStarted", () => {
      console.log("gameStarted received");
      setGameStarted(true);
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
      setRoundStartTime(Date.now() - (90 - time) * 1000); // Sync client timer with server
    });

    newSocket.on("gameEnd", ({ scores, winner }) => {
      console.log("gameEnd received:", { scores, winner });
      setScores(scores);
      setGameWinner(winner);
      setGameEnded(true);
      if (timerRef.current) clearInterval(timerRef.current);
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

  const joinRoom = () => {
    if (socket && roomId && username) {
      socket.emit("joinRoom", { roomId, username });
      setIsJoined(true);
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

  if (!isJoined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="block w-full p-2 border"
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="block w-full p-2 border"
          />
          <button
            onClick={joinRoom}
            className="px-4 py-2 bg-blue-500 text-white"
          >
            Join Room
          </button>
        </div>
      </div>
    );
  }

  if (gameEnded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Game Over!</h1>
          <p>Winner: {gameWinner}</p>
          <h2 className="mt-4">Final Scores:</h2>
          <ul>
            {Object.entries(scores).map(([player, score]) => (
              <li key={player}>
                {player}: {score}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2>Waiting for the game to start...</h2>
          <h3>Players in Room:</h3>
          <ul>
            {players.map((player) => (
              <li key={player}>
                {player} {player === username && isAdmin && "(Admin)"}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <button
              onClick={startGame}
              className="mt-4 px-4 py-2 bg-blue-500 text-white"
            >
              Start Game
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex gap-4">
        <div>
          <h2>Players:</h2>
          <ul>
            {players.map((player) => (
              <li key={player}>
                {player} {player === currentDrawer && "(Drawing)"} -{" "}
                {scores[player] || 0} pts
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>
            Round {round}/{maxRounds} - Word: {word} - Time: {timeLeft}s
          </h2>
          <canvas
            ref={canvasRef}
            width={800}
            height={400}
            className="border"
            onMouseDown={startDrawing}
            onMouseUp={stopDrawing}
            onMouseMove={draw}
          />
          <div className="mt-2">
            <input
              type="text"
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="Your guess"
              className="p-2 border"
              disabled={username === currentDrawer}
            />
            <button
              onClick={submitGuess}
              className="ml-2 px-4 py-2 bg-green-500 text-white"
              disabled={username === currentDrawer}
            >
              Guess
            </button>
          </div>
          <div className="mt-2">
            <h3>Guesses:</h3>
            {guesses.map((guess, i) => (
              <div key={i}>{guess}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
