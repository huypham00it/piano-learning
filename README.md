# 🎹 Luyện Hợp Âm Piano

Webapp giúp ghi nhớ hợp âm piano. Kết nối đàn với máy tính qua **cáp MIDI (USB-MIDI)**, chọn các hợp âm cần học, rồi luyện tập với các bài tập tự chấm điểm trên **bàn phím piano** và **khuông nhạc**.

## Tính năng

- **Kết nối MIDI** qua Web MIDI API: tự nhận thiết bị khi cắm/rút, chọn thiết bị nếu có nhiều đàn. Có thể bật "Tiếng cho đàn MIDI" nếu đàn không có loa.
- **Không có đàn vẫn dùng được**: bấm chuột/chạm vào phím trên màn hình, hoặc dùng bàn phím máy tính (`A W S E D F T G Y H U J K …`, `Z`/`X` để đổi quãng tám).
- **Chọn hợp âm** trong bảng 12 nốt gốc × 20 loại hợp âm (trưởng, thứ, giảm, tăng, sus2, sus4, 7, maj7, m7, m(maj7), m7b5, dim7, 7sus4, 6, m6, add9, m(add9), 9, maj9, m9). Có sẵn các bộ chọn nhanh: hợp âm cơ bản, tất cả trưởng/thứ, hợp âm 7, hợp âm trong một giọng.
- **Học**: xem hợp âm trên khuông nhạc (khóa Sol/khóa Fa, ký âm đúng tên nốt, kể cả dấu thăng/giáng kép), các phím cần bấm, công thức quãng, các thế đảo; nghe hợp âm (đồng thời hoặc rải) và tự kiểm tra khi chơi.
- **Luyện tập** với 4 dạng bài (hoặc trộn lẫn):
  1. Nhìn tên hợp âm → chơi trên đàn
  2. Đọc hợp âm trên khuông nhạc → chơi trên đàn
  3. Nhìn khuông nhạc → chọn tên đúng (4 đáp án, phím tắt `1`–`4`)
  4. Nhìn phím đàn được tô sáng → chọn tên đúng
  
  Tùy chọn: số câu, thế gốc/thế đảo, kiểm tra nốt trầm, giới hạn thời gian mỗi câu, gợi ý sau N lần sai. Khi chơi sai, ứng dụng hiển thị nốt bạn chơi cạnh đáp án trên khuông nhạc và tô đỏ phím sai.
- **Lặp lại ngắt quãng (Leitner)**: mỗi hợp âm có "mức nhớ" 1–5; hợp âm hay sai hoặc chơi chậm sẽ xuất hiện thường xuyên hơn. Tab **Thống kê** cho thấy độ chính xác, thời gian trung bình và cho phép luyện riêng các hợp âm yếu.
- Thanh dưới cùng luôn hiển thị các nốt đang bấm, tên hợp âm nhận diện được và khuông nhạc nhỏ.
- Dữ liệu (hợp âm đã chọn, thiết lập, thống kê) được lưu trong trình duyệt (localStorage).

## Chạy thử

Ứng dụng là trang tĩnh thuần HTML/CSS/JavaScript, không cần build và không có thư viện phụ thuộc.

```bash
npm start            # = npx serve -l 5173 .
# hoặc
python3 -m http.server 5173
```

Mở <http://localhost:5173>.

> **Lưu ý về MIDI**: Web MIDI chỉ hoạt động trên trang `https://` hoặc `http://localhost`, và được hỗ trợ trên **Chrome, Edge, Opera** (máy tính và Android). Safari/iOS chưa hỗ trợ Web MIDI; Firefox cần cấp quyền khi được hỏi.
>
> Cách kết nối: cắm cáp USB-MIDI (hoặc cáp USB-B của đàn) vào máy tính → mở ứng dụng → bấm **Kết nối MIDI** → cho phép truy cập thiết bị MIDI.

## Triển khai lên GitHub Pages

Workflow `.github/workflows/pages.yml` chạy test rồi triển khai khi push lên nhánh `main`. Cần bật **Settings → Pages → Source: GitHub Actions** cho repository.

## Kiểm thử

```bash
npm test
```

Các test (`tests/theory.test.js`) kiểm tra ký âm hợp âm, thế đảo, nhận diện hợp âm và chấm điểm.

## Cấu trúc

```
index.html        Giao diện chính
css/style.css     Giao diện (hỗ trợ chế độ tối, responsive)
js/theory.js      Lý thuyết nhạc: ký âm, dựng hợp âm, thế đảo, nhận diện
js/practice.js    Bộ máy bài tập: chọn câu hỏi theo trọng số, đáp án nhiễu, thống kê
js/staff.js       Vẽ khuông nhạc (SVG)
js/glyphs.js      Hình khóa nhạc và dấu hóa (trích từ font GNU FreeSerif)
js/keyboard.js    Bàn phím piano trên màn hình
js/midi.js        Kết nối Web MIDI
js/audio.js       Bộ tổng hợp âm thanh piano đơn giản (Web Audio)
js/app.js         Điều khiển ứng dụng
```
