const express = require("express");
const axios = require("axios");
const ThuatToanB52 = require("./thuattoan.js");

const app = express();
const PORT = process.env.PORT || 8000;

const POLL_INTERVAL = 5000;
const MAX_HISTORY = 50;

// Khởi tạo đối tượng thuật toán
const thuattoan = new ThuatToanB52();

let latest_result_100 = {
  phien: 0,
  xuc_xac_1: 0,
  xuc_xac_2: 0,
  xuc_xac_3: 0,
  tong: 0,
  ket_qua: "Chưa có",
  phien_hien_tai: 0,
  du_doan: "Chưa có dữ liệu",
  do_tin_cay: 0
};

let latest_result_101 = { ...latest_result_100 };

let history_100 = [];
let history_101 = [];

let last_sid_100 = null;
let last_sid_101 = null;
let sid_for_tx = null;

/*-----------------------
  Helper Functions
-----------------------*/
function updateResult(store, history, result) {
  Object.assign(store, result);
  history.unshift({ ...result });
  if (history.length > MAX_HISTORY) history.pop();
}

/*-----------------------
  Poll API
-----------------------*/
async function pollAPI(gid, is_md5) {
  const url = `https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=b5&gid=${gid}`;
  while (true) {
    try {
      const { data } = await axios.get(url, { 
        headers: { "User-Agent": "Node-Proxy/1.0" }, 
        timeout: 10000 
      });
      
      if (data.status === "OK" && Array.isArray(data.data)) {
        for (const game of data.data) {
          if (!is_md5 && game.cmd === 1008) {
            sid_for_tx = game.sid;
          }
        }
        
        for (const game of data.data) {
          if (is_md5 && game.cmd === 2006) {
            const { sid, d1, d2, d3 } = game;
            if (sid && sid !== last_sid_101 && d1 != null && d2 != null && d3 != null) {
              last_sid_101 = sid;
              const ket_qua = thuattoan.getTaiXiu(d1, d2, d3);
              const tong = d1 + d2 + d3;
              const du_doan_result = thuattoan.duDoan(history_101);
              const do_tin_cay = thuattoan.calculateConfidence(history_101, du_doan_result);
              
              const result = {
                phien: sid,
                xuc_xac_1: d1,
                xuc_xac_2: d2,
                xuc_xac_3: d3,
                tong: tong,
                ket_qua: ket_qua,
                phien_hien_tai: sid + 1,
                du_doan: du_doan_result,
                do_tin_cay: do_tin_cay
              };
              updateResult(latest_result_101, history_101, result);
              console.log(`[MD5] Phiên ${sid} - Tổng: ${tong}, Kết quả: ${ket_qua}, Dự đoán: ${du_doan_result}, Độ tin cậy: ${do_tin_cay}%`);
            }
          } else if (!is_md5 && game.cmd === 1003) {
            const { d1, d2, d3 } = game;
            const sid = sid_for_tx;
            if (sid && sid !== last_sid_100 && d1 != null && d2 != null && d3 != null) {
              last_sid_100 = sid;
              const ket_qua = thuattoan.getTaiXiu(d1, d2, d3);
              const tong = d1 + d2 + d3;
              const du_doan_result = thuattoan.duDoan(history_100);
              const do_tin_cay = thuattoan.calculateConfidence(history_100, du_doan_result);
              
              const result = {
                phien: sid,
                xuc_xac_1: d1,
                xuc_xac_2: d2,
                xuc_xac_3: d3,
                tong: tong,
                ket_qua: ket_qua,
                phien_hien_tai: sid + 1,
                du_doan: du_doan_result,
                do_tin_cay: do_tin_cay
              };
              updateResult(latest_result_100, history_100, result);
              console.log(`[TX] Phiên ${sid} - Tổng: ${tong}, Kết quả: ${ket_qua}, Dự đoán: ${du_doan_result}, Độ tin cậy: ${do_tin_cay}%`);
              sid_for_tx = null;
            }
          }
        }
      }
    } catch (err) {
      console.error(`Lỗi khi lấy dữ liệu API ${gid}:`, err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

/*-----------------------
  Routes
-----------------------*/
app.get("/api/taixiu", (req, res) => {
  const result = { 
    phien: latest_result_100.phien,
    xuc_xac_1: latest_result_100.xuc_xac_1,
    xuc_xac_2: latest_result_100.xuc_xac_2,
    xuc_xac_3: latest_result_100.xuc_xac_3,
    tong: latest_result_100.tong,
    ket_qua: latest_result_100.ket_qua,
    phien_hien_tai: latest_result_100.phien_hien_tai,
    du_doan: latest_result_100.du_doan,
    do_tin_cay: latest_result_100.do_tin_cay
  };
  res.json(result);
});

app.get("/api/taixiumd5", (req, res) => {
  const result = { 
    phien: latest_result_101.phien,
    xuc_xac_1: latest_result_101.xuc_xac_1,
    xuc_xac_2: latest_result_101.xuc_xac_2,
    xuc_xac_3: latest_result_101.xuc_xac_3,
    tong: latest_result_101.tong,
    ket_qua: latest_result_101.ket_qua,
    phien_hien_tai: latest_result_101.phien_hien_tai,
    du_doan: latest_result_101.du_doan,
    do_tin_cay: latest_result_101.do_tin_cay
  };
  res.json(result);
});

app.get("/api/history", (req, res) => {
  const formattedHistory100 = history_100.map(item => ({
    phien: item.phien,
    xuc_xac_1: item.xuc_xac_1,
    xuc_xac_2: item.xuc_xac_2,
    xuc_xac_3: item.xuc_xac_3,
    tong: item.tong,
    ket_qua: item.ket_qua,
    phien_hien_tai: item.phien_hien_tai,
    du_doan: item.du_doan,
    do_tin_cay: item.do_tin_cay
  }));
  
  const formattedHistory101 = history_101.map(item => ({
    phien: item.phien,
    xuc_xac_1: item.xuc_xac_1,
    xuc_xac_2: item.xuc_xac_2,
    xuc_xac_3: item.xuc_xac_3,
    tong: item.tong,
    ket_qua: item.ket_qua,
    phien_hien_tai: item.phien_hien_tai,
    du_doan: item.du_doan,
    do_tin_cay: item.do_tin_cay
  }));
  
  res.json({ 
    taixiu: formattedHistory100, 
    taixiumd5: formattedHistory101 
  });
});

app.get("/", (req, res) => {
  res.send("API Server for TaiXiu is running. Endpoints: /api/taixiu, /api/taixiumd5, /api/history");
});

/*-----------------------
  Start polling
-----------------------*/
console.log("Khởi động hệ thống API Tài Xỉu...");
pollAPI("vgmn_100", false);
pollAPI("vgmn_101", true);
console.log("Đã bắt đầu polling dữ liệu.");

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
