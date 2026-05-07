const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

class GameWebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.isAuthenticated = false;
        this.sessionId = null;
        this.latestTxData = null;   // Dữ liệu bàn tài xỉu thường (cmd 1005)
        this.latestMd5Data = null;  // Dữ liệu bàn MD5 (cmd 1105)
        this.lastUpdateTime = {
            tx: null,
            md5: null
        };
    }

    connect() {
        console.log('🔗 Connecting to WebSocket server...');
        
        this.ws = new WebSocket(this.url, {
            headers: {
                'Host': 'xkhsa.apita228.net',
                'Origin': 'https://play.ta28.you',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
                'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
                'Sec-WebSocket-Version': '13'
            }
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.ws.on('open', () => {
            console.log('✅ Connected to WebSocket server');
            this.reconnectAttempts = 0;
            this.sendAuthentication();
        });

        this.ws.on('message', (data) => {
            this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 Connection closed. Code: ${code}, Reason: ${String(reason)}`);
            this.isAuthenticated = false;
            this.sessionId = null;
            this.handleReconnect();
        });

        this.ws.on('pong', () => {
            console.log('❤️  Heartbeat received from server');
        });
    }

    sendAuthentication() {
        console.log('🔐 Sending authentication (updated credentials)...');
        
        // Thông tin xác thực mới cho tài khoản wanglin20199
        const authMessage = [
            1,
            "MiniGame",
            "WangLin20199",         // username mới
            "vansang208@A",        // password mới
            {
                "signature": "0969804B0DAA341A09192FDA6E0F2071533287D6B78318C1682427FC215D0281B07D8EDCC690117A711C57B9C02217EAB7B9A5007DCEBB1E812571A1FC959C581423789519066AB396683309D6F511FBF9461F4E225956421085E9F5621FD4E48B78E57C9F20D3779F317BD6A8638BE942D03E89E68CA77377082BE12B877AE8",
                "info": {
                    "cs": "1a02fee81bf21889bb3d3a005c5a9e27",
                    "phone": "",
                    "ipAddress": "171.253.169.187",
                    "isMerchant": false,
                    "userId": "9e869de3-c5e4-4056-adcb-5bfe72946f1b",
                    "deviceId": "050105373613900053736078036024",
                    "isMktAccount": false,
                    "username": "wanglin20199",
                    "timestamp": 1778125442616
                },
                "pid": 4
            }
        ];

        this.sendRaw(authMessage);
    }

    sendPluginMessages() {
        console.log('🚀 Sending plugin initialization messages...');
        
        const pluginMessages = [
            [6,"MiniGame","taixiuMd5Plugin",{"cmd":1105}],
            [6,"MiniGame","taixiuPlugin",{"cmd":1005}],
            [6,"MiniGame","taixiuLiveRoomPlugin",{"cmd":1305,"rid":0}],
            [6,"MiniGame","taixiuLiveRoomPlugin",{"cmd":1305,"rid":5}],
            [6,"MiniGame","lobbyPlugin",{"cmd":10001}],
            [6,"MiniGame","channelPlugin",{"cmd":310}]
        ];

        pluginMessages.forEach((message, index) => {
            setTimeout(() => {
                console.log(`📤 Sending plugin ${index + 1}/${pluginMessages.length}: ${message[2]}`);
                this.sendRaw(message);
            }, index * 1000);
        });

        // Thiết lập interval để refresh dữ liệu mỗi 30 giây
        setInterval(() => {
            this.refreshGameData();
        }, 30000);
    }

    refreshGameData() {
        if (this.isAuthenticated && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('🔄 Refreshing game data...');
            
            const refreshTx = [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }];
            const refreshMd5 = [6, "MiniGame", "taixiuMd5Plugin", { "cmd": 1105 }];
            
            this.sendRaw(refreshTx);
            setTimeout(() => {
                this.sendRaw(refreshMd5);
            }, 1000);
        }
    }

    sendRaw(data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            const jsonString = JSON.stringify(data);
            this.ws.send(jsonString);
            console.log('📤 Sent raw:', jsonString);
            return true;
        } else {
            console.log('⚠️ Cannot send, WebSocket not open');
            return false;
        }
    }

    handleMessage(data) {
        try {
            const parsed = JSON.parse(data);
            
            // XỬ LÝ CMD 1005 - BÀN TÀI XỈU THƯỜNG
            if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1005) {
                console.log('🎯 Nhận được dữ liệu cmd 1005 (Bàn TX)');
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                    console.log(`🎲 Bàn TX - Phiên gần nhất: ${latestSession.sid} (${latestSession.d1},${latestSession.d2},${latestSession.d3})`);
                    this.latestTxData = gameData;
                    this.lastUpdateTime.tx = new Date();
                    console.log('💾 Đã cập nhật dữ liệu bàn TX');
                }
            }
            
            // XỬ LÝ CMD 1105 - BÀN MD5
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1105) {
                console.log('🎯 Nhận được dữ liệu cmd 1105 (Bàn MD5)');
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                    console.log(`🎲 Bàn MD5 - Phiên gần nhất: ${latestSession.sid} (${latestSession.d1},${latestSession.d2},${latestSession.d3})`);
                    this.latestMd5Data = gameData;
                    this.lastUpdateTime.md5 = new Date();
                    console.log('💾 Đã cập nhật dữ liệu bàn MD5');
                }
            }
            
            // Xử lý response authentication (type 5, có cmd 100)
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 100) {
                console.log('🔑 Authentication successful!');
                const userData = parsed[1];
                console.log(`✅ User: ${userData.u}`);
                this.isAuthenticated = true;
                setTimeout(() => {
                    console.log('🔄 Starting to send plugin messages...');
                    this.sendPluginMessages();
                }, 2000);
            }
            
            // Xử lý response type 1 - Session initialization
            else if (parsed[0] === 1 && parsed.length >= 5 && parsed[4] === "MiniGame") {
                console.log('✅ Session initialized');
                this.sessionId = parsed[3];
                console.log(`📋 Session ID: ${this.sessionId}`);
            }
            
            // Xử lý response type 7 - Plugin response
            else if (parsed[0] === 7) {
                const pluginName = parsed[2];
                console.log(`🔄 Plugin ${pluginName} response received`);
            }
            
            // Xử lý heartbeat/ping response
            else if (parsed[0] === 0) {
                console.log('❤️  Heartbeat received');
            }
            
        } catch (e) {
            console.log('📥 Raw message:', data.toString());
            console.error('❌ Parse error:', e.message);
        }
    }

    getLatestTxSession() {
        if (!this.latestTxData || !this.latestTxData.htr || this.latestTxData.htr.length === 0) {
            return { error: "Không có dữ liệu bàn TX", message: "Chưa nhận được dữ liệu từ server hoặc dữ liệu trống" };
        }
        try {
            const latestSession = this.latestTxData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
            const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
            const ket_qua = (tong >= 11) ? "tài" : "xỉu";
            return {
                phien: latestSession.sid,
                xuc_xac_1: latestSession.d1,
                xuc_xac_2: latestSession.d2,
                xuc_xac_3: latestSession.d3,
                tong: tong,
                ket_qua: ket_qua,
                timestamp: new Date().toISOString(),
                ban: "tai_xiu",
                last_updated: this.lastUpdateTime.tx ? this.lastUpdateTime.tx.toISOString() : null
            };
        } catch (error) {
            return { error: "Lỗi xử lý dữ liệu TX", message: error.message };
        }
    }

    getLatestMd5Session() {
        if (!this.latestMd5Data || !this.latestMd5Data.htr || this.latestMd5Data.htr.length === 0) {
            return { error: "Không có dữ liệu bàn MD5", message: "Chưa nhận được dữ liệu từ server hoặc dữ liệu trống" };
        }
        try {
            const latestSession = this.latestMd5Data.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
            const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
            const ket_qua = (tong >= 11) ? "tài" : "xỉu";
            return {
                phien: latestSession.sid,
                xuc_xac_1: latestSession.d1,
                xuc_xac_2: latestSession.d2,
                xuc_xac_3: latestSession.d3,
                tong: tong,
                ket_qua: ket_qua,
                timestamp: new Date().toISOString(),
                ban: "md5",
                last_updated: this.lastUpdateTime.md5 ? this.lastUpdateTime.md5.toISOString() : null
            };
        } catch (error) {
            return { error: "Lỗi xử lý dữ liệu MD5", message: error.message };
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            console.log(`🔄 Attempting to reconnect in ${delay}ms (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
                console.log('🔄 Reconnecting...');
                this.connect();
            }, delay);
        } else {
            console.log('❌ Max reconnection attempts reached');
        }
    }

    startHeartbeat() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const heartbeatMsg = [0, this.sessionId || ""];
                this.sendRaw(heartbeatMsg);
                console.log('❤️  Sending heartbeat...');
            }
        }, 25000);
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// KHỞI TẠO EXPRESS SERVER
const app = express();
const PORT = 3000;
app.use(cors());
app.use(express.json());

// Tạo WebSocket client - URL giữ nguyên
const client = new GameWebSocketClient(
    'wss://xkhsa.apita228.net/websocket?d=YjJ4aWNHZGlhMjg9fDIyM3wxNzY2NDcyMDY5NzA2fGM1YzhkZGEyNGRkYjY1YWRmZDFjY2Y2OTM1MjkxNTFlfDJlODc2ZDk4NWViYWJhZmY0NTVmOWU0ZmY1NWI3YTQ4'
);
client.connect();

// Routes API
app.get('/api/tx', (req, res) => {
    const data = client.getLatestTxSession();
    if (data.error) return res.status(404).json(data);
    res.json(data);
});

app.get('/api/md5', (req, res) => {
    const data = client.getLatestMd5Session();
    if (data.error) return res.status(404).json(data);
    res.json(data);
});

app.get('/api/all', (req, res) => {
    const txSession = client.getLatestTxSession();
    const md5Session = client.getLatestMd5Session();
    res.json({
        tai_xiu: txSession.error ? { error: txSession.error } : txSession,
        md5: md5Session.error ? { error: md5Session.error } : md5Session,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    const hasTxData = client.latestTxData && client.latestTxData.htr && client.latestTxData.htr.length > 0;
    const hasMd5Data = client.latestMd5Data && client.latestMd5Data.htr && client.latestMd5Data.htr.length > 0;
    res.json({
        status: "running",
        websocket_connected: client.ws ? client.ws.readyState === WebSocket.OPEN : false,
        authenticated: client.isAuthenticated,
        has_tx_data: hasTxData,
        has_md5_data: hasMd5Data,
        tx_last_updated: client.lastUpdateTime.tx ? client.lastUpdateTime.tx.toISOString() : null,
        md5_last_updated: client.lastUpdateTime.md5 ? client.lastUpdateTime.md5.toISOString() : null,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/refresh', (req, res) => {
    if (client.isAuthenticated && client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.refreshGameData();
        res.json({ message: "Đã gửi yêu cầu refresh dữ liệu", timestamp: new Date().toISOString() });
    } else {
        res.status(400).json({ error: "Không thể refresh", message: "WebSocket chưa kết nối hoặc chưa xác thực" });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>API Status</title></head>
            <body><h1>API is running</h1><p>Use endpoints: /api/tx, /api/md5, /api/all, /api/status</p></body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});

setTimeout(() => {
    client.startHeartbeat();
}, 10000);

process.on('SIGINT', () => {
    console.log('\n👋 Closing WebSocket connection and server...');
    client.close();
    process.exit();
});

module.exports = { GameWebSocketClient, app };
