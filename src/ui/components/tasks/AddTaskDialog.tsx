import { useState } from "react";
import { Button } from "@ui/components/ui/button";
import { Input } from "@ui/components/ui/input";
import { Textarea } from "@ui/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@ui/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@ui/components/ui/select";
import type { TaskCategory } from "@core/types/task";

interface AddTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (task: {
        title: string;
        description?: string;
        category: TaskCategory;
    }) => void;
    isPending: boolean;
}

export function AddTaskDialog({
    open,
    onOpenChange,
    onSubmit,
    isPending,
}: AddTaskDialogProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState<TaskCategory>("general");

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) return;

        onSubmit({
            title: title.trim(),
            description: description.trim() || undefined,
            category,
        });

        setTitle("");
        setDescription("");
        setCategory("general");
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Task</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Input
                            placeholder="Task title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div>
                        <Textarea
                            placeholder="Description (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <div>
                        <Select
                            value={category}
                            onValueChange={(v) =>
                                setCategory(v as TaskCategory)
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="general">General</SelectItem>
                                <SelectItem value="tech_debt">
                                    Tech Debt
                                </SelectItem>
                                <SelectItem value="tests">Tests</SelectItem>
                                <SelectItem value="docs">Docs</SelectItem>
                                <SelectItem value="security">
                                    Security
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!title.trim() || isPending}
                        >
                            {isPending ? "Adding..." : "Add Task"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
