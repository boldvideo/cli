class Boldvideo < Formula
  desc "Run your Bold video library from a shell"
  homepage "https://boldvideo.com"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-darwin-arm64"
      sha256 "c33f9ad7b96a0d5a941c96b3e39077d5f163f6eaaa32d3c3e379b3e6c04ef5fe"
    end
    on_intel do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-darwin-x64"
      sha256 "8ac8ae839dc0b10b965eb8d97a86400a7ef50366bb634b68ccef02a8592be826"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-linux-arm64"
      sha256 "aaf13a40212b87a31723f42537b7d63d1f7c4c1348e9762b8bb98e4e31815a45"
    end
    on_intel do
      url "https://github.com/boldvideo/cli/releases/download/v#{version}/boldvideo-linux-x64"
      sha256 "6b2e26c4ece31ee396605104c7c2333eb327f0d223f13127b2e7fa932bccf40f"
    end
  end

  def install
    bin.install Dir["boldvideo-*"].first => "boldvideo"
    # The short name for typing; boldvideo stays the name in docs and help.
    bin.install_symlink "boldvideo" => "bold"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boldvideo --version")
    assert_match version.to_s, shell_output("#{bin}/bold --version")
  end
end
