# Hướng dẫn phát hành

Tài liệu dành cho người bảo trì repo. README là tài liệu cho người dùng.

## 1. Chuẩn bị một lần duy nhất

### 1.1. Tạo Azure DevOps organization

Marketplace của VS Code xác thực qua Azure DevOps chứ không phải GitHub.

1. Vào https://dev.azure.com và đăng nhập bằng tài khoản Microsoft.
2. Tạo một organization mới nếu chưa có (tên gì cũng được, không hiện ra công khai).

### 1.2. Tạo Personal Access Token

1. Trong Azure DevOps: góc phải trên → **User settings** → **Personal access tokens** → **New Token**.
2. Điền đúng ba mục sau, sai một mục là `vsce publish` sẽ trả `401 Unauthorized`:

   | Trường | Giá trị bắt buộc |
   | --- | --- |
   | Organization | **All accessible organizations** (không phải organization cụ thể) |
   | Scopes | **Custom defined** → mục **Marketplace** → tick **Manage** |
   | Expiration | Tối đa 1 năm; ghi lịch nhắc gia hạn |

3. Copy token ngay — Azure DevOps không cho xem lại.

### 1.3. Tạo publisher

1. Vào https://marketplace.visualstudio.com/manage → **Create publisher**.
2. **Publisher ID** phải trùng chính xác trường `publisher` trong [package.json](package.json), hiện đang là `luongdong059`. Nếu ID này đã có người lấy, đổi cả hai chỗ cho khớp.
3. Điền display name, logo, mô tả.

### 1.4. Nạp token vào GitHub

```sh
gh secret set VSCE_PAT --repo luongdong059/claude-noti
# dán token vào khi được hỏi
```

Chưa nạp secret thì workflow release vẫn chạy xong và vẫn tạo GitHub release kèm file `.vsix`, chỉ bỏ qua bước đẩy lên Marketplace và ghi một warning. Nghĩa là có thể phát hành bản đầu tiên trên GitHub trước, lo tài khoản Marketplace sau.

### 1.5. Tuỳ chọn — Open VSX

Cursor, Windsurf và VSCodium không lấy extension từ Marketplace của Microsoft mà từ Open VSX. Extension này chạy được trên các bản fork đó (phần nhận diện app bundle làm việc theo tiến trình đang chạy chứ không hardcode đường dẫn VS Code), nên đăng cả hai nơi là hợp lý.

1. Đăng nhập https://open-vsx.org bằng GitHub, tạo access token.
2. Ký Publisher Agreement — bắt buộc, nếu không sẽ bị từ chối ở lần publish đầu.
3. `gh secret set OVSX_PAT --repo luongdong059/claude-noti`

## 2. Quy trình phát hành một phiên bản

```sh
# 1. Kiểm tra sạch trước
npm run typecheck && npm run test

# 2. Nâng version (tự sửa package.json, không tự tag)
npm version patch --no-git-tag-version    # hoặc minor / major

# 3. Ghi CHANGELOG.md cho phiên bản mới

# 4. Đóng gói và thử trên máy trước khi đẩy đi
npm run package
code --install-extension claude-noti-*.vsix --force
# reload cửa sổ, chạy "Claude Noti: Run Diagnostics" và "Send Test Notification"

# 5. Commit và tag
git add -A
git commit -m "release: v0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

Push tag lên là workflow [release.yml](.github/workflows/release.yml) chạy: kiểm tra tag khớp `package.json`, typecheck, lint, test, đóng gói, tạo GitHub release kèm `.vsix`, rồi đẩy lên Marketplace và Open VSX nếu có token.

### Lưu ý về Node trên máy này

`vsce` 3.x cần Node 20 trở lên, trong khi `node -v` trên máy đang là 18. Homebrew có sẵn Node 25, dùng nó khi chạy `vsce`:

```sh
PATH="/opt/homebrew/Cellar/node/25.9.0_1/bin:$PATH" npx vsce package
```

CI dùng Node 20 nên không vướng chuyện này.

## 3. Publish thủ công khi cần

Khi CI hỏng hoặc muốn đẩy gấp:

```sh
export VSCE_PAT=<token>
PATH="/opt/homebrew/Cellar/node/25.9.0_1/bin:$PATH" npx vsce publish --packagePath claude-noti-0.1.0.vsix
```

Đẩy bản pre-release để thử nghiệm mà không ảnh hưởng người dùng bản ổn định:

```sh
npx vsce publish --pre-release
```

Gỡ một phiên bản đã đăng nhầm (không xoá được hẳn, chỉ ẩn đi):

```sh
npx vsce unpublish luongdong059.claude-noti
```

## 4. Kiểm tra sau khi phát hành

- Trang extension: https://marketplace.visualstudio.com/items?itemName=luongdong059.claude-noti
- Mất khoảng 5–10 phút để hiện ra sau khi publish thành công.
- Kiểm tra README hiển thị đúng, icon lên đúng, link repo bấm được.
- Thử `code --install-extension luongdong059.claude-noti` trên một máy sạch.

## 5. Sự cố thường gặp

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `401 Unauthorized` khi publish | PAT sai scope, hoặc chọn organization cụ thể thay vì *All accessible organizations*, hoặc đã hết hạn |
| `ERROR Missing publisher name` | Trường `publisher` trong `package.json` trống hoặc không khớp publisher đã tạo |
| `ERROR The extension 'xxx' already exists` | Publisher ID đã có người dùng — đổi sang tên khác trong `package.json` |
| `File is not defined` khi chạy vsce | Đang chạy Node 18, xem mục Node ở trên |
| Marketplace từ chối vì thiếu repository | Trường `repository` phải là URL git công khai hợp lệ |
| Icon không hiện | Phải là PNG ít nhất 128×128 và được liệt kê trong file `.vsix` — chạy `npx vsce ls` để kiểm tra |

## 6. Những thứ CI đang kiểm

[ci.yml](.github/workflows/ci.yml) chạy trên mọi push vào `main` và mọi pull request:

- `npm run typecheck` — TypeScript strict
- `npm run lint` — ESLint
- `npm run test:unit` — 55 unit test
- `npx vsce package` — bắt sớm các lỗi metadata khiến Marketplace từ chối

File `.vsix` của mỗi lần chạy được giữ làm artifact 14 ngày, tiện để thử bản build của một pull request mà không cần tự đóng gói.
