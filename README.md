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
- **Vòng hợp âm** (tab ④): tạo danh sách hợp âm theo thứ tự — từ vòng mẫu theo giọng (I–V–vi–IV, I–vi–IV–V, vi–ii–V–I, Canon, ii–V–I, Blues 12 ô nhịp, các vòng giọng thứ…) hoặc chọn từ **bảng hợp âm** (theo giọng kèm ký hiệu La Mã I, ii, V7…, các hợp âm đã chọn ở tab ①, hoặc tất cả hợp âm theo nốt gốc): bấm để thêm vào cuối, hoặc kéo thả vào đúng vị trí. **Kéo thả** để sắp xếp lại (chuột hoặc cảm ứng; bàn phím: phím mũi tên trên biểu tượng ⠿); lưu/mở nhiều vòng.
  - Tự chọn thế bấm **dẫn giọng mượt** (tay di chuyển ít nhất, giữ nốt chung), có thể chỉnh thế bấm từng hợp âm; tay trái chơi nốt gốc hoặc quãng 8.
  - **Chỉ dẫn ngón tay**: số ngón (1 = ngón cái … 5 = ngón út) hiện trên phím đàn (xanh = tay phải, cam = tay trái) và trên khuông nhạc; phím viền vàng báo trước hợp âm kế tiếp; hướng dẫn từng bước chuyển hợp âm (“Giữ nguyên phím G bằng ngón 5”, “Ngón 1: C → B (xuống nửa cung)”, “Tay trái: C → G”…).
  - 3 chế độ: xem từng bước, luyện chờ chơi đúng (đo thời gian từng lần chuyển hợp âm, chỉ ra bước chuyển chậm/sai), luyện theo nhịp với máy đếm nhịp (BPM, số phách mỗi hợp âm, đếm vào 1 ô nhịp). Có thể kiểm tra đúng thế bấm và tay trái.
- **Bài hát** (tab ⑤): tập bài hát kiểu người mới — **tay phải đánh giai điệu từng nốt, tay trái đánh nốt gốc của hợp âm** (với hợp âm có dấu “/”, ví dụ Am/C, tay trái đánh nốt sau dấu “/”).
  - Bản nhạc khuông kép cuộn ngang: giai điệu, nốt trầm tay trái, tên hợp âm, số ngón tay cho cả hai tay (tự tính theo thế tay 5 ngón), con trỏ theo vị trí đang tập.
  - Chế độ: **Chờ chơi đúng** (máy chờ bạn bấm đúng từng nốt), **Theo nhịp** (đếm vào 1 ô nhịp, máy đếm nhịp, chấm đúng/lỡ nhịp), **Nghe mẫu**. Chọn tập tay phải, tay trái hoặc hai tay; máy có thể chơi phần của tay còn lại; chọn đoạn “Ô nhịp … đến …”, lặp lại, chỉnh tốc độ. Kết quả chỉ ra các ô nhịp cần tập thêm.
  - Có sẵn 2 bài mẫu thuộc phạm vi công cộng (Twinkle Twinkle Little Star, Ode to Joy). Thêm bài bằng trình soạn thảo với ký hiệu dạng chữ (có kiểm tra tổng trường độ từng ô nhịp), hoặc **Nhập file** `.txt`; **Xuất file** để sao lưu. Bài hát của bạn chỉ lưu trong trình duyệt, không đưa lên trang web.
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

Workflow `.github/workflows/static.yml` triển khai trang khi push lên nhánh `main` sau khi chạy `npm test`; nếu test lỗi thì trang không được cập nhật. Cần bật **Settings → Pages → Source: GitHub Actions** cho repository.

## Kiểm thử

```bash
npm test
```

Các test kiểm tra ký âm hợp âm, thế đảo, nhận diện và chấm điểm (`tests/theory.test.js`), cũng như vòng hợp âm: tên hợp âm theo giọng, số ngón tay, dẫn giọng, chấm thế bấm và hướng dẫn chuyển hợp âm (`tests/progression.test.js`); bài hát: hợp âm, hóa biểu, trường độ, dấu nối, nốt trầm, số ngón tay (`tests/song.test.js`).

## Cấu trúc

```
index.html        Giao diện chính
css/style.css     Giao diện (hỗ trợ chế độ tối, responsive)
js/theory.js      Lý thuyết nhạc: ký âm, dựng hợp âm, thế đảo, nhận diện
js/practice.js    Bộ máy bài tập: chọn câu hỏi theo trọng số, đáp án nhiễu, thống kê
js/progression.js Vòng hợp âm: vòng mẫu, dẫn giọng, số ngón tay, chấm điểm, hướng dẫn chuyển hợp âm
js/progressionView.js Giao diện tab Vòng hợp âm (xem từng bước, luyện chờ đúng, luyện theo nhịp)
js/song.js        Bài hát: đọc ký hiệu dạng chữ, kiểm tra trường độ, nốt trầm tay trái, số ngón tay, chuỗi phím cần bấm
js/scoreView.js   Vẽ bản nhạc bài hát (khuông kép cuộn ngang)
js/songView.js    Giao diện tab Bài hát (thư viện, soạn thảo, chờ chơi đúng / theo nhịp / nghe mẫu)
js/demoSongs.js   Bài mẫu thuộc phạm vi công cộng
js/staff.js       Vẽ khuông nhạc (SVG)
js/glyphs.js      Hình khóa nhạc và dấu hóa (trích từ font GNU FreeSerif)
js/keyboard.js    Bàn phím piano trên màn hình
js/midi.js        Kết nối Web MIDI
js/audio.js       Bộ tổng hợp âm thanh piano đơn giản (Web Audio)
js/app.js         Điều khiển ứng dụng
```
