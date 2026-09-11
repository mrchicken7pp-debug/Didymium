import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, doc, onSnapshot, setDoc, updateDoc 
} from "firebase/firestore";
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from "firebase/auth";
import { 
  Users, Moon, Sun, Eye, ShieldAlert, Skull, Play, Crown, RefreshCw, Copy 
} from "lucide-react";

// 你的 diddy-test Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyB9sxYCA7_ayevgpY9BtWrK7nHJIR7bkv8",
  authDomain: "diddy-test.firebaseapp.com",
  databaseURL: "https://diddy-test-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "diddy-test",
  storageBucket: "diddy-test.firebasestorage.app",
  messagingSenderId: "440500416154",
  appId: "1:440500416154:web:9da15df2b9e1d24ea4f923",
  measurementId: "G-K4CYPM9SWR"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 產生 4 位數隨機房間代碼
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

export default function App() {
  const [user, setUser] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [roomId, setRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [error, setError] = useState("");

  // 1. 匿名登入
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) setUser(currentUser);
      else signInAnonymously(auth);
    });
    return () => unsubscribe();
  }, []);

  // 2. 監聽房間資料變化
  useEffect(() => {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        setRoomData(docSnap.data());
      } else {
        setError("房間不存在或已解散");
        setRoomId(null);
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  // 創建房間
  const createRoom = async () => {
    if (!playerName.trim()) return setError("請輸入玩家名稱");
    const newRoomId = generateRoomCode();
    const roomRef = doc(db, "rooms", newRoomId);
    
    await setDoc(roomRef, {
      hostId: user.uid,
      phase: "lobby", // lobby, night, day, game_over
      players: {
        [user.uid]: { name: playerName, isAlive: true, role: null }
      },
      nightActions: { wolfTarget: null, seerTarget: null },
      dayVotes: {},
      systemMessage: "等待玩家加入中..."
    });
    
    setRoomId(newRoomId);
    setError("");
  };

  // 加入房間
  const joinRoom = async () => {
    if (!playerName.trim()) return setError("請輸入玩家名稱");
    if (!roomCodeInput.trim()) return setError("請輸入房間代碼");
    
    const code = roomCodeInput.toUpperCase();
    const roomRef = doc(db, "rooms", code);
    
    // 先寫入玩家資料，如果房間不存在會觸發錯誤 (由 Firestore 規則保護或稍後被覆蓋)
    // 為了簡化，直接嘗試更新
    try {
      await setDoc(roomRef, {
        players: { [user.uid]: { name: playerName, isAlive: true, role: null } }
      }, { merge: true });
      setRoomId(code);
      setError("");
    } catch (err) {
      setError("無法加入房間，請確認代碼正確");
    }
  };

  // 遊戲邏輯：分配角色並開始遊戲
  const startGame = async () => {
    if (!roomData) return;
    const playerIds = Object.keys(roomData.players);
    if (playerIds.length < 3) return setError("至少需要 3 名玩家才能開始");

    // 簡單角色分配：1 狼人, 1 預言家, 其他平民
    const shuffled = [...playerIds].sort(() => 0.5 - Math.random());
    const newPlayers = { ...roomData.players };
    
    shuffled.forEach((id, index) => {
      if (index === 0) newPlayers[id].role = "狼人";
      else if (index === 1) newPlayers[id].role = "預言家";
      else newPlayers[id].role = "平民";
      newPlayers[id].isAlive = true;
    });

    await updateDoc(doc(db, "rooms", roomId), {
      players: newPlayers,
      phase: "night",
      nightActions: { wolfTarget: null, seerTarget: null },
      dayVotes: {},
      systemMessage: "天黑請閉眼。狼人請選擇要襲擊的對象，預言家請選擇要查驗的對象。"
    });
  };

  // 遊戲邏輯：執行夜晚行動 (狼人殺人 / 預言家驗人)
  const handleNightAction = async (targetId) => {
    if (roomData.phase !== "night" || !roomData.players[user.uid].isAlive) return;
    const myRole = roomData.players[user.uid].role;
    const roomRef = doc(db, "rooms", roomId);

    if (myRole === "狼人") {
      await updateDoc(roomRef, { "nightActions.wolfTarget": targetId });
    } else if (myRole === "預言家") {
      await updateDoc(roomRef, { "nightActions.seerTarget": targetId });
      const targetRole = roomData.players[targetId].role;
      alert(`【預言家查驗結果】 ${roomData.players[targetId].name} 的身分是：${targetRole === "狼人" ? "壞人" : "好人"}`);
    }
  };

  // 遊戲邏輯：結束夜晚，進入白天
  const endNight = async () => {
    const targetId = roomData.nightActions.wolfTarget;
    const newPlayers = { ...roomData.players };
    let msg = "昨晚是個平安夜，沒有人死亡。";

    if (targetId) {
      newPlayers[targetId].isAlive = false;
      msg = `天亮了。昨晚 ${newPlayers[targetId].name} 被殺害了。`;
    }

    await updateDoc(doc(db, "rooms", roomId), {
      players: newPlayers,
      phase: "day",
      systemMessage: msg + " 請大家討論並投票選出要放逐的玩家。",
      dayVotes: {}
    });
  };

  // 判斷遊戲是否結束
  const checkWinCondition = async () => {
    const alivePlayers = Object.values(roomData.players).filter(p => p.isAlive);
    const aliveWolves = alivePlayers.filter(p => p.role === "狼人").length;
    const aliveGood = alivePlayers.length - aliveWolves;

    let winner = null;
    if (aliveWolves === 0) winner = "好人陣營獲勝！";
    else if (aliveWolves >= aliveGood) winner = "狼人陣營獲勝！";

    if (winner) {
      await updateDoc(doc(db, "rooms", roomId), { phase: "game_over", systemMessage: winner });
      return true;
    }
    return false;
  };

  // 渲染尚未加入房間的 UI
  if (!roomId || !roomData) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md text-center border border-slate-700">
          <Moon className="w-16 h-16 mx-auto mb-4 text-indigo-400" />
          <h1 className="text-3xl font-bold mb-8 tracking-widest">狼人殺</h1>
          
          <input
            className="w-full bg-slate-700 p-3 rounded-lg mb-4 text-center text-lg outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="輸入你的暱稱"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          
          <div className="flex gap-4 mb-4">
            <input
              className="w-1/2 bg-slate-700 p-3 rounded-lg text-center text-lg outline-none uppercase placeholder:capitalize focus:ring-2 focus:ring-indigo-500"
              placeholder="房間代碼"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
            />
            <button 
              onClick={joinRoom}
              className="w-1/2 bg-indigo-600 hover:bg-indigo-500 transition p-3 rounded-lg font-bold"
            >
              加入房間
            </button>
          </div>
          
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-600"></div>
            <span className="flex-shrink-0 mx-4 text-slate-400">或</span>
            <div className="flex-grow border-t border-slate-600"></div>
          </div>

          <button 
            onClick={createRoom}
            className="w-full bg-slate-600 hover:bg-slate-500 transition p-3 rounded-lg font-bold mt-2"
          >
            創建新房間
          </button>
          
          {error && <p className="text-red-400 mt-4">{error}</p>}
        </div>
      </div>
    );
  }

  // 以下為進入房間後的遊戲 UI
  const isHost = roomData.hostId === user.uid;
  const myData = roomData.players[user.uid] || {};
  const allPlayers = Object.entries(roomData.players);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* 頂部資訊列 */}
        <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6 shadow-lg">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              房間代碼：<span className="text-indigo-400 tracking-widest">{roomId}</span>
              <Copy className="w-5 h-5 cursor-pointer text-slate-400 hover:text-white" onClick={() => navigator.clipboard.writeText(roomId)}/>
            </h2>
            <p className="text-slate-400 text-sm mt-1">你的暱稱：{myData.name}</p>
          </div>
          <div className="text-right">
            <span className={`px-4 py-1.5 rounded-full text-sm font-bold ${
              roomData.phase === 'lobby' ? 'bg-slate-600' :
              roomData.phase === 'night' ? 'bg-indigo-900 text-indigo-200' :
              roomData.phase === 'day' ? 'bg-orange-800 text-orange-200' : 'bg-green-800 text-green-200'
            }`}>
              {roomData.phase === 'lobby' && '等待中'}
              {roomData.phase === 'night' && '夜晚階段'}
              {roomData.phase === 'day' && '白天討論'}
              {roomData.phase === 'game_over' && '遊戲結束'}
            </span>
          </div>
        </div>

        {/* 系統訊息 */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 mb-6 text-center shadow-lg">
          <p className="text-lg md:text-xl text-slate-300">{roomData.systemMessage}</p>
          
          {/* 我的身分卡 (遊戲開始後顯示) */}
          {roomData.phase !== 'lobby' && (
            <div className="mt-4 p-4 bg-slate-700 inline-block rounded-lg">
              <p className="text-sm text-slate-400">你的身分</p>
              <p className={`text-2xl font-bold ${myData.role === '狼人' ? 'text-red-400' : 'text-blue-400'}`}>
                {myData.role} {!myData.isAlive && " (已死亡)"}
              </p>
            </div>
          )}
        </div>

        {/* 玩家列表與互動區 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {allPlayers.map(([id, player]) => (
            <div 
              key={id} 
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                !player.isAlive ? 'border-red-900/50 bg-slate-800/50 opacity-60' : 
                'border-slate-700 bg-slate-800 hover:border-slate-500'
              }`}
            >
              {player.isAlive ? <Users className="w-8 h-8 text-slate-400"/> : <Skull className="w-8 h-8 text-red-500"/>}
              <span className="font-bold">{player.name} {id === user.uid && "(你)"}</span>
              
              {/* 夜晚行動按鈕 */}
              {roomData.phase === 'night' && myData.isAlive && player.isAlive && id !== user.uid && (
                <>
                  {myData.role === '狼人' && (
                    <button onClick={() => handleNightAction(id)} className="text-xs bg-red-600 hover:bg-red-500 px-3 py-1 rounded-full mt-2 w-full">
                      {roomData.nightActions.wolfTarget === id ? '已鎖定' : '襲擊'}
                    </button>
                  )}
                  {myData.role === '預言家' && (
                    <button onClick={() => handleNightAction(id)} className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded-full mt-2 w-full">
                      {roomData.nightActions.seerTarget === id ? '已查驗' : '查驗'}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* 房主控制面板 */}
        {isHost && (
          <div className="bg-slate-800 p-4 rounded-xl border border-indigo-500/30 flex justify-center gap-4">
            <Crown className="w-6 h-6 text-yellow-500 hidden md:block" />
            {roomData.phase === 'lobby' && (
              <button onClick={startGame} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                <Play className="w-4 h-4"/> 開始遊戲
              </button>
            )}
            {roomData.phase === 'night' && (
              <button onClick={endNight} className="bg-orange-600 hover:bg-orange-500 px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                <Sun className="w-4 h-4"/> 天亮了 (結束夜晚)
              </button>
            )}
            {roomData.phase === 'day' && (
              <button onClick={checkWinCondition} className="bg-red-600 hover:bg-red-500 px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                <Skull className="w-4 h-4"/> 結算白天 (判斷勝負)
              </button>
            )}
            {roomData.phase === 'game_over' && (
              <button onClick={startGame} className="bg-green-600 hover:bg-green-500 px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                <RefreshCw className="w-4 h-4"/> 再玩一局
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
