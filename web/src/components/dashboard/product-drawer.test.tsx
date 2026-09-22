import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductDrawer } from "./product-drawer";
import type { Product } from "@/lib/dashboard/types";

const product: Product = { id: "prod_1", livemode: false, name: "GPU", description: null, rateUsdPerSecond: "0.004", allowPause: false, startMode: "checkout", status: "active", activeSubscriptions: 0, createdAt: 0 };

describe("ProductDrawer", () => {
  it("FR_DSH_114_create_blocks_submit_until_name_and_rate_pass_the_shared_rules", async () => {
    const onSubmit = vi.fn();
    render(<ProductDrawer open initial={undefined} error={null} busy={false} onCancel={() => {}} onSubmit={onSubmit} />);
    const save = screen.getByRole("button", { name: "Create product" });
    expect(save).toBeDisabled();
    const name = screen.getByLabelText("Name");
    const rate = screen.getByLabelText("Rate per second (USD)");
    expect(name).toHaveAttribute("maxlength", "200");
    expect(screen.getByLabelText(/Description/)).toHaveAttribute("maxlength", "1000");
    await userEvent.type(name, "  GPU  ");
    // FR-DSH-114: the rate field refuses keystrokes that could never form a rate (letters, a second
    // dot, a seventh decimal) instead of accepting them and complaining afterwards.
    await userEvent.type(rate, "abc");
    expect(rate).toHaveValue("");
    expect(screen.queryByText("Enter a decimal like 0.004.")).toBeNull();
    expect(save).toBeDisabled();
    await userEvent.type(rate, "0.0000001");
    expect(rate).toHaveValue("0.000000");
    await userEvent.clear(rate);
    await userEvent.type(rate, "0..0-04x");
    expect(rate).toHaveValue("0.004");
    await userEvent.clear(rate);
    await userEvent.type(rate, "0.004");
    expect(screen.getByText(/\/ min ·/)).toBeInTheDocument();
    expect(save).toBeEnabled();
    await userEvent.click(save);
    // FR-DSH-144 widened the payload; the rest of this assertion is unchanged.
    expect(onSubmit).toHaveBeenCalledWith({ name: "GPU", rateUsdPerSecond: "0.004", description: null, allowPause: false, startMode: "checkout" });
  });

  it("FR_DSH_144_create_defaults_to_starting_at_checkout", async () => {
    const onSubmit = vi.fn();
    render(<ProductDrawer open initial={undefined} error={null} busy={false} onCancel={() => {}} onSubmit={onSubmit} />);
    // The default is the common case, so a merchant who never touches the choice still gets a
    // product that starts when the subscriber authorises.
    expect(screen.getByRole("radio", { name: /At checkout/ })).toBeChecked();
    await userEvent.type(screen.getByLabelText("Name"), "GPU");
    await userEvent.type(screen.getByLabelText("Rate per second (USD)"), "0.004");
    await userEvent.click(screen.getByRole("button", { name: "Create product" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startMode: "checkout" }));
  });

  it("FR_DSH_144_choosing_the_second_card_submits_a_merchant_start_product", async () => {
    const onSubmit = vi.fn();
    render(<ProductDrawer open initial={undefined} error={null} busy={false} onCancel={() => {}} onSubmit={onSubmit} />);
    const merchant = screen.getByRole("radio", { name: /When your code starts it/ });
    // The card names the method the merchant must call and what forgetting it costs the subscriber.
    expect(merchant).toHaveAccessibleName(/subscriptions\.start/);
    expect(merchant).toHaveAccessibleName(/refunds in full after 15 minutes/);
    await userEvent.click(merchant);
    expect(screen.getByRole("radio", { name: /At checkout/ })).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("Name"), "Serverless runtime");
    await userEvent.type(screen.getByLabelText("Rate per second (USD)"), "0.002");
    await userEvent.click(screen.getByRole("button", { name: "Create product" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startMode: "merchant" }));
  });

  it("FR_DSH_116_edit_shows_the_rate_read_only_and_points_at_a_new_product", () => {
    render(<ProductDrawer open initial={product} error={null} busy={false} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByLabelText("Rate per second (USD)")).toBeNull();
    expect(screen.getByText("$0.004 / second")).toBeInTheDocument();
    expect(screen.getByText("To change the rate, create a new product.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("FR_DSH_144_edit_shows_the_start_mode_read_only_and_points_at_a_new_product", () => {
    // `UpdateProduct` does not accept start_mode, so an editable control would be a lie: the
    // server would take the save and ignore the field.
    render(<ProductDrawer open initial={{ ...product, startMode: "merchant" }} error={null} busy={false} onCancel={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("When your code starts it")).toBeInTheDocument();
    expect(screen.getByText("To change this, create a new product.")).toBeInTheDocument();
  });

  it("FR_DSH_115_a_server_rejection_lands_under_the_field_it_names", () => {
    render(<ProductDrawer open initial={undefined} error={{ field: "name", message: "Keep it under 200 characters." }} busy={false} onCancel={() => {}} onSubmit={() => {}} />);
    const name = screen.getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Keep it under 200 characters.");
  });
});
